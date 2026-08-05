// @ts-check

import test from 'node:test';
import assert from 'node:assert/strict';
import { BackgroundLayer } from '../js/render/layers/background.js';

/**
 * Contexte Canvas réduit à ce que `render` en fait, et qui **retient la source** de chaque
 * `drawImage`. C'est ce qui permet de distinguer « a peint la carte pleine taille » de « a peint la
 * doublure » de « n'a rien peint » — trois cas que le compte d'appels seul confond, et dont la
 * confusion laissait le chemin froid sans aucune couverture.
 */
function createMockCtx() {
  /** @type {any[]} */
  const sources = [];
  return {
    sources,
    save() {},
    restore() {},
    fillRect() {},
    fillText() {},
    fillStyle: '',
    font: '',
    textAlign: '',
    textBaseline: '',
    /** @param {any} source */
    drawImage(source) {
      sources.push(source);
    },
  };
}

/**
 * Objet-image contrôlable : `decode()` ne se résout que quand le test le décide, ce qui est le seul
 * moyen d'observer l'état pendant qu'un décodage est en vol.
 *
 * @param {{ hasDecode?: boolean }} [options]
 */
function createMockImage(options = {}) {
  const hasDecode = options.hasDecode ?? true;
  /** @type {(value?: any) => void} */
  let resolveDecode = () => {};
  /** @type {(reason?: any) => void} */
  let rejectDecode = () => {};
  const decodePromise = new Promise((res, rej) => {
    resolveDecode = res;
    rejectDecode = rej;
  });
  decodePromise.catch(() => {});

  const img = {
    src: '',
    naturalWidth: 2000,
    naturalHeight: 2000,
    width: 2000,
    height: 2000,
    /** @type {any} */
    onload: null,
    /** @type {any} */
    onerror: null,
    decodeCalls: 0,
    decode: hasDecode
      ? () => {
          img.decodeCalls++;
          return decodePromise;
        }
      : undefined,
    resolveDecode: () => resolveDecode(),
    rejectDecode: () => rejectDecode(new Error('decode a échoué')),
  };
  return img;
}

/** Laisse passer les micro-tâches et les `setTimeout(0)` en vol. */
const laisserFilerLesPromesses = () => new Promise((r) => setTimeout(r, 5));

/**
 * Monte une couche dont l'horloge est pilotée par le test, image chargée.
 *
 * @param {string} url
 * @param {{ hasDecode?: boolean, depart?: number }} [options]
 */
async function monter(url, options = {}) {
  const img = createMockImage(options);
  let invalidations = 0;
  let temps = options.depart ?? 10_000;
  const layer = new BackgroundLayer({
    invalidate: () => invalidations++,
    imageFactory: () => /** @type {any} */ (img),
    clock: () => temps,
  });
  const chargement = layer.load(url);
  img.onload?.();
  await chargement;
  return {
    layer,
    img,
    invalidations: () => invalidations,
    avancer: (/** @type {number} */ ms) => {
      temps += ms;
    },
    maintenant: () => temps,
  };
}

test('BackgroundLayer — la première peinture après onload est FROIDE', async () => {
  // `onload` dit que l'image est chargée, pas que ses pixels sont décodés. La mesure du chantier N a
  // chiffré cette confusion : 484 ms sur la première frame qui peint réellement la carte. Déclarer
  // l'image chaude au chargement conserverait ce gel intact — et la version précédente de ce test
  // l'épinglait comme si c'était le comportement voulu.
  const { layer, img } = await monter('/froid-au-chargement.jpg');
  const ctx = createMockCtx();

  layer.render(/** @type {any} */ (ctx), 1000, 1000);

  assert.deepEqual(ctx.sources, [], 'aucune peinture pleine taille avant un décodage');
  assert.equal(img.decodeCalls, 1, 'un décodage est lancé');
});

test('BackgroundLayer — froide aussi quand la page vient de démarrer (horloge proche de zéro)', async () => {
  // `performance.now()` est monotone et vaut quelques centaines de millisecondes juste après le
  // chargement de la page. Une sentinelle « jamais décodée » à 0 rendait donc `now - decodedAt`
  // inférieur au seuil pendant les quatre premières secondes de vie de l'onglet : une carte ouverte
  // tôt était présumée chaude et repayait les 484 ms, de façon non déterministe puisque cela dépend
  // de la vitesse de démarrage. C'est le piège que ce test épingle.
  const { layer, img } = await monter('/page-fraichement-demarree.jpg', { depart: 120 });
  const ctx = createMockCtx();

  layer.render(/** @type {any} */ (ctx), 1000, 1000);

  assert.deepEqual(ctx.sources, [], 'froide malgré une horloge à 120 ms');
  assert.equal(img.decodeCalls, 1);
});

test('BackgroundLayer — la résolution du décodage rend chaud, et le temps qui passe rend froid', async () => {
  const { layer, img, avancer } = await monter('/regle-de-chaleur.jpg');
  const ctx = createMockCtx();

  layer.render(/** @type {any} */ (ctx), 1000, 1000);
  img.resolveDecode();
  await laisserFilerLesPromesses();

  // Chaud sans que l'horloge ait bougé : c'est la résolution qui fait foi, pas le temps.
  layer.render(/** @type {any} */ (ctx), 1000, 1000);
  assert.deepEqual(ctx.sources, [img], 'la carte pleine taille est peinte');

  // Encore chaud juste sous le seuil.
  avancer(3999);
  ctx.sources.length = 0;
  layer.render(/** @type {any} */ (ctx), 1000, 1000);
  assert.deepEqual(ctx.sources, [img]);
  assert.equal(img.decodeCalls, 1);

  // Chaque peinture pleine taille repousse l'échéance : trois frames à 3999 ms d'écart restent
  // chaudes. C'est ce qui garantit qu'en interaction continue la doublure n'apparaît jamais.
  avancer(3999);
  ctx.sources.length = 0;
  layer.render(/** @type {any} */ (ctx), 1000, 1000);
  assert.deepEqual(ctx.sources, [img]);
  assert.equal(img.decodeCalls, 1);

  // Froid au-delà du seuil, sans nouvelle peinture entre-temps.
  avancer(4001);
  ctx.sources.length = 0;
  layer.render(/** @type {any} */ (ctx), 1000, 1000);
  assert.deepEqual(ctx.sources, [], 'rien de pleine taille sur un état froid');
  assert.equal(img.decodeCalls, 2, 'un second décodage est lancé');
});

test('BackgroundLayer — un décodage plus long que le seuil ne relance pas de décodage (pas de boucle)', async () => {
  // ⭐ Le test qui garde la terminaison. Avec l'horloge de la frame froide capturée dans le `then`,
  // un décodage de 4,5 s — 245 Mio sur la tablette, ce n'est pas une hypothèse d'école — laissait
  // l'état froid à la frame suivante, qui relançait un décodage, qui invalidait, indéfiniment :
  // 60 fps à vide et carte définitivement floue.
  const { layer, img, avancer, invalidations } = await monter('/decodage-lent.jpg');
  const ctx = createMockCtx();

  layer.render(/** @type {any} */ (ctx), 1000, 1000);
  assert.equal(img.decodeCalls, 1);

  // Le décodage prend 4,5 s de temps réel, donc plus que le seuil de chaleur.
  avancer(4500);
  img.resolveDecode();
  await laisserFilerLesPromesses();
  const invalidationsApresDecodage = invalidations();

  ctx.sources.length = 0;
  layer.render(/** @type {any} */ (ctx), 1000, 1000);
  assert.deepEqual(ctx.sources, [img], 'la frame suivante peint net');
  assert.equal(img.decodeCalls, 1, 'et ne relance pas de décodage');

  ctx.sources.length = 0;
  layer.render(/** @type {any} */ (ctx), 1000, 1000);
  assert.equal(img.decodeCalls, 1);
  assert.equal(invalidations(), invalidationsApresDecodage, 'aucune invalidation en chaîne');
});

test('BackgroundLayer — deux rendus froids consécutifs ne lancent qu’un seul décodage', async () => {
  const { layer, img, invalidations } = await monter('/idempotence.jpg');
  const ctx = createMockCtx();

  layer.render(/** @type {any} */ (ctx), 1000, 1000);
  assert.equal(img.decodeCalls, 1);
  const avant = invalidations();

  layer.render(/** @type {any} */ (ctx), 1000, 1000);
  assert.equal(img.decodeCalls, 1, 'le décodage en vol garde la place');
  assert.equal(invalidations(), avant);
});

test('BackgroundLayer — un décodage en échec ne rend pas l’image chaude et n’est pas retenté', async () => {
  // Marquer chaud sur échec ferait repeindre en pleine taille et en synchrone à la frame suivante :
  // le gel reviendrait par le chemin d'erreur. Rester froid sans renoncer, à l'inverse, relancerait
  // un décodage à chaque frame. Il faut donc renoncer explicitement à `decode()` pour cette image.
  const { layer, img, invalidations, avancer } = await monter('/decodage-en-echec.jpg');
  const ctx = createMockCtx();

  layer.render(/** @type {any} */ (ctx), 1000, 1000);
  img.rejectDecode();
  await laisserFilerLesPromesses();
  const apresEchec = invalidations();

  ctx.sources.length = 0;
  layer.render(/** @type {any} */ (ctx), 1000, 1000);
  layer.render(/** @type {any} */ (ctx), 1000, 1000);

  assert.equal(img.decodeCalls, 1, 'aucun nouvel essai de décodage');
  assert.equal(invalidations(), apresEchec, 'aucune invalidation en chaîne');
  assert.equal(ctx.sources.length, 2, 'on repasse au comportement d’avant le chantier, borné');

  // ⭐ C'est **au-delà du seuil** que le renoncement se distingue d'un simple « marqué chaud » :
  // une chaleur datée redeviendrait froide après 4 s et relancerait un décodage à chaque nouvelle
  // pause, indéfiniment, sur une image dont on sait que `decode()` échoue.
  avancer(10_000);
  ctx.sources.length = 0;
  layer.render(/** @type {any} */ (ctx), 1000, 1000);
  assert.equal(img.decodeCalls, 1, 'toujours aucun nouvel essai, même après le seuil');
  assert.deepEqual(ctx.sources, [img], 'et la carte reste peinte');
});

test('BackgroundLayer — sans `decode()`, un seul renoncement et aucune boucle', async () => {
  const { layer, img, invalidations } = await monter('/sans-decode.jpg', { hasDecode: false });
  const ctx = createMockCtx();
  const apresChargement = invalidations();

  layer.render(/** @type {any} */ (ctx), 1000, 1000);
  assert.equal(invalidations(), apresChargement + 1, 'une invalidation pour le renoncement');

  layer.render(/** @type {any} */ (ctx), 1000, 1000);
  layer.render(/** @type {any} */ (ctx), 1000, 1000);
  assert.equal(invalidations(), apresChargement + 1, 'et une seule');
  assert.equal(ctx.sources.length, 2, 'les frames suivantes peignent, faute de mieux');
  assert.equal(img.decodeCalls, 0);
});

test('BackgroundLayer — le chemin froid peint la DOUBLURE, pas la carte pleine taille', async () => {
  // `createImageBitmap` n'existe pas sous Node : sans ce leurre, la doublure reste nulle, le chemin
  // froid ne peint rien, et aucun test ne peut distinguer « a peint la doublure » de « n'a rien
  // peint ». C'est le seul comportement que l'utilisateur verra, il doit être gardé.
  const doublure = { doublure: true, close() {} };
  const original = /** @type {any} */ (globalThis).createImageBitmap;
  /** @type {any} */ (globalThis).createImageBitmap = async () => doublure;
  try {
    const { layer, img } = await monter('/avec-doublure.jpg');
    await laisserFilerLesPromesses();
    const ctx = createMockCtx();

    layer.render(/** @type {any} */ (ctx), 1000, 1000);
    assert.deepEqual(ctx.sources, [doublure], 'la doublure est peinte sur le chemin froid');

    img.resolveDecode();
    await laisserFilerLesPromesses();
    ctx.sources.length = 0;
    layer.render(/** @type {any} */ (ctx), 1000, 1000);
    assert.deepEqual(ctx.sources, [img], 'et la carte nette une fois le décodage résolu');
  } finally {
    /** @type {any} */ (globalThis).createImageBitmap = original;
  }
});

test('BackgroundLayer — au-delà de deux doublures, les plus anciennes sont fermées', async () => {
  // Une doublure de 1024 px fait ~3,9 Mio hors tas, que le ramasse-miettes ne rend pas de lui-même.
  // Huit entrées de cache en retiendraient ~31 Mio, contre les 8 Mio du critère 5 du chantier P.
  /** @type {{ nom: string, ferme: boolean }[]} */
  const doublures = [];
  const original = /** @type {any} */ (globalThis).createImageBitmap;

  try {
    for (let i = 0; i < 4; i++) {
      const suivi = { nom: `d${i}`, ferme: false };
      doublures.push(suivi);
      /** @type {any} */ (globalThis).createImageBitmap = async () => ({
        close() {
          suivi.ferme = true;
        },
      });
      await monter(`/budget-doublures-${i}.jpg`);
      await laisserFilerLesPromesses();
    }

    assert.deepEqual(
      doublures.map((d) => d.ferme),
      [true, true, false, false],
      'seules les deux dernières doublures survivent'
    );
  } finally {
    /** @type {any} */ (globalThis).createImageBitmap = original;
  }
});

test('BackgroundLayer — une entrée évincée du cache ne devient pas « présumée chaude »', async () => {
  // Le cache ne garde que huit entrées. L'entrée de l'image affichée peut donc en sortir alors que
  // l'instance tient encore son image : présumer chaud faute d'entrée ramènerait le gel de 490 ms
  // sans que rien ne le signale.
  const { layer, img, avancer } = await monter('/evincee.jpg');
  const ctx = createMockCtx();

  layer.render(/** @type {any} */ (ctx), 1000, 1000);
  img.resolveDecode();
  await laisserFilerLesPromesses();
  ctx.sources.length = 0;
  layer.render(/** @type {any} */ (ctx), 1000, 1000);
  assert.deepEqual(ctx.sources, [img], 'chaud avant éviction');

  // Neuf autres cartes chargées par une autre instance : le cache est partagé, l'entrée sort.
  for (let i = 0; i < 9; i++) {
    await monter(`/pousse-hors-du-cache-${i}.jpg`);
  }

  avancer(10_000);
  ctx.sources.length = 0;
  layer.render(/** @type {any} */ (ctx), 1000, 1000);
  assert.deepEqual(ctx.sources, [], 'froid, et non présumé chaud');
  assert.equal(img.decodeCalls, 2, 'un décodage est lancé pour retrouver la chaleur');
});
