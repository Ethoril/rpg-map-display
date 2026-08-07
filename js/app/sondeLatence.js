// @ts-nocheck
/**
 * Sonde de latence — module chargeable depuis la console de la fenêtre MJ.
 *
 *     import('./js/app/sondeLatence.js')
 *
 * ⭐ **Ce fichier existe parce que le copier-coller a échoué.** La sonde était livrée comme cent
 * lignes à coller dans la console ; le mainteneur a copié la clôture Markdown avec, et a reçu un
 * `ReferenceError: js is not defined`. Une ligne à taper ne peut pas rater de cette façon.
 *
 * Le mode d'emploi et la lecture des quatre nombres sont dans `docs/SONDE-LATENCE.md`.
 *
 * ⚠ Aucun autre module ne l'importe : il ne se charge que sur demande explicite, et ne coûte donc
 * rien en séance tant que personne ne le réclame.
 */

(async () => {
  // ⚠ Chemin relatif au MODULE, alors que le bloc publié dans docs/SONDE-LATENCE.md le résout
  // depuis la PAGE. C'est la seule ligne par laquelle les deux versions diffèrent, et le test de
  // parité la neutralise avant de comparer. Une première version avait copié le chemin de la
  // console dans le module : l'import échouait et la sonde ne s'armait jamais, en silence.
  const store = await import('../state/store.js');
  const app = window.__RPG_APP__;
  const tr = app.transport;
  // Le vrai transport range ses abonnés dans `_subscribers`, celui des tests dans `listeners`.
  // La sonde accepte les deux, pour être éprouvable en local avant d'être collée en séance.
  const abonnes = tr && (tr._subscribers || tr.listeners);
  if (!abonnes) { console.error('Transport introuvable — la page MJ est-elle connectée ?'); return; }

  const releves = [];
  let enCours = null;

  // ── t1 : l'événement arrive. Écouteur inséré EN TÊTE.
  //
  // ⚠ `subscribe` ajoute en fin de liste : un écouteur ajouté normalement serait appelé APRÈS
  // ceux de l'application, et daterait donc l'arrivée une fois le poste ayant déjà tout traité.
  // C'est l'erreur commise par la première version de la sonde automatisée, qui rapportait
  // 613 ms de « réseau » qui n'en étaient pas.
  const anciens = [...abonnes];
  abonnes.clear();
  const premier = (e) => {
    if (e?.type !== 'token.move') return;
    enCours = {
      type: e.type,
      emis: e.at || 0,          // horloge de l'émetteur
      arrivee: Date.now(),      // horloge locale
      t1: performance.now(),
      t1bis: 0, t2: 0, t3: 0,
    };
  };
  abonnes.add(premier);
  for (const s of anciens) abonnes.add(s);

  // ── t1bis : tous les gestionnaires de l'application ont fini. Écouteur ajouté en DERNIER.
  const dernier = (e) => {
    if (e?.type !== 'token.move' || !enCours) return;
    enCours.t1bis = performance.now();
  };
  abonnes.add(dernier);

  // ── t2 : la mutation est visible dans le store.
  const desabonner = store.subscribe(() => {
    if (enCours && !enCours.t2) enCours.t2 = performance.now();
  });

  // ── t3 : l'écran s'est repeint.
  const boucle = () => {
    if (enCours && enCours.t2 && !enCours.t3) {
      enCours.t3 = performance.now();
      const r = enCours;
      enCours = null;
      const decalage = r.emis ? r.arrivee - r.emis : NaN;
      releves.push({
        'réseau (ms)': Math.round(decalage),
        'traitement app (ms)': +(r.t1bis - r.t1).toFixed(1),
        'vers le store (ms)': +(r.t2 - r.t1).toFixed(1),
        'vers le repaint (ms)': +(r.t3 - r.t1).toFixed(1),
      });
      console.log(
        `#${releves.length}  réseau ${String(Math.round(decalage)).padStart(6)} ms   ` +
        `app ${(r.t1bis - r.t1).toFixed(1).padStart(6)} ms   ` +
        `store ${(r.t2 - r.t1).toFixed(1).padStart(6)} ms   ` +
        `repaint ${(r.t3 - r.t1).toFixed(1).padStart(6)} ms`
      );
    }
    if (sonde._actif) requestAnimationFrame(boucle);
  };

  window.sonde = {
    _actif: true,
    releves,
    decalageServeur: () => (tr._serverTimeOffset ?? 0),
    bilan() {
      if (!releves.length) { console.log('Aucun déplacement joueur relevé.'); return; }
      console.table(releves);
      const med = (k) => {
        const v = releves.map((r) => r[k]).filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
        return v.length ? v[Math.floor(v.length / 2)] : NaN;
      };
      console.log(
        `\nMÉDIANES sur ${releves.length} déplacements :\n` +
        `  réseau            ${med('réseau (ms)')} ms\n` +
        `  traitement app    ${med('traitement app (ms)')} ms\n` +
        `  vers le store     ${med('vers le store (ms)')} ms\n` +
        `  vers le repaint   ${med('vers le repaint (ms)')} ms\n` +
        `  décalage d'horloge serveur connu du transport : ${(tr._serverTimeOffset ?? 0)} ms`
      );
    },
    stop() {
      this._actif = false;
      abonnes.delete(premier);
      abonnes.delete(dernier);
      desabonner();
      console.log('Sonde arrêtée.');
    },
  };
  requestAnimationFrame(boucle);
  console.log('Sonde armée. Fais bouger un pion côté joueur, puis tape sonde.bilan()');
})();
