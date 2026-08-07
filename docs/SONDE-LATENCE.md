# Sonde de latence — à coller dans la console de la fenêtre MJ

> **Pourquoi cette sonde existe.** Le mainteneur signale, le 7 août 2026, une latence « qui se
> compte en secondes » entre le déplacement d'un pion par un joueur et sa réplication sur l'écran
> MJ. Le sens inverse paraît instantané.
>
> ⚠ **La mesure automatisée du 7 août ne répond PAS à cette question, et il faut le savoir avant
> de lire quoi que ce soit** : elle tourne sur le transport de test, un canal local du navigateur.
> Elle a donc mesuré un réseau qui n'existe pas en séance, et conclu « le réseau n'est pas en
> cause » sur la foi de 33 ms qui ne représentaient rien. La vraie session passe par **Firebase**,
> dont la latence n'a jamais été mesurée — `ETAT.md` note que la décision qui la concerne a été
> « tranchée par architecture, pas par mesure ».
>
> Cette sonde-ci tourne dans la **vraie** fenêtre MJ, au premier plan, sur la vraie session.

---

## Mode d'emploi — une seule ligne

1. Ouvre la fenêtre MJ, connectée à la session, avec la carte chargée.
2. Ouvre la console du navigateur (F12) et tape **cette ligne** :

   ```
   import('./js/app/sondeLatence.js')
   ```

3. Fais déplacer un pion **par le joueur**, plusieurs fois.
4. Tape `sonde.bilan()` pour le résumé.

Pour arrêter : `sonde.stop()`.

⭐ **Pourquoi une ligne et non un bloc à coller.** La première version de ce document ne
proposait que le bloc ci-dessous. Le mainteneur a copié la clôture Markdown avec le code et a
reçu `Uncaught ReferenceError: js is not defined` — la ligne ` ```js ` interprétée comme du
JavaScript. Une ligne à taper ne peut pas rater de cette façon. Le bloc reste publié plus bas
pour être lisible et vérifiable, mais il n'est plus le chemin recommandé.

---

## Ancien bloc retiré — utiliser l'import ci-dessus

Le code est maintenant maintenu dans `js/app/sondeLatence.js` : un second bloc à copier avait fini
par diverger. L'import recommandé est le seul chemin d'exécution. L'ancien texte ci-dessous est
conservé uniquement comme historique de l'instrument, et ne doit pas être copié.

```text
(async () => {
  const store = await import('./js/state/store.js');
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
```

---

## Comment lire les mesures

Ils désignent quatre coupables différents, qui se corrigent à quatre endroits opposés.

| colonne | ce qu'elle mesure | si elle est grosse |
|---|---|---|
| **réseau** | de la publication par le joueur à l'arrivée chez le MJ | Firebase, ou la file d'événements. C'est le seul poste qui peut se compter en secondes |
| **traitement app** | le temps que les gestionnaires du MJ passent, **synchrone**, sur cet événement | le réducteur, la vision, la publication du fog |
| **vers le store** | de l'arrivée à la mutation visible | idem, plus les validations et les clones |
| **attente rAF** | du store à la fin de la vraie frame applicative | l'ordonnancement de frame. Ce n'est pas le coût des couches. |
| **vers la frame exécutée** | de l'arrivée à la fin de `renderAll` | le délai local jusqu'à l'exécution Canvas, sans prétendre mesurer le compositing écran. |
| **présentation** | qualification de l'échantillon | si l'onglet a été masqué entre mutation et frame, l'affichage n'est pas mesurable : le throttling rAF est signalé, pas attribué au renderer. |

**Important :** une frame exécutée est la fin du JavaScript de rendu, pas un accusé de réception du
compositeur ou de l'écran. Et quand l'onglet est masqué, le délai avant cette frame est le scheduling
du navigateur (rAF throttlé ou suspendu), non une « latence de rendu ». Ces échantillons restent
utiles pour constater une suspension, mais ne se comparent pas à une mesure au premier plan.

⚠ **La colonne « réseau » compare deux horloges différentes** — celle de la tablette et celle du
poste MJ. Un décalage entre les deux machines s'y ajoute tel quel. Trois garde-fous pour la lire :

- une valeur **négative** est la preuve d'un décalage d'horloge, pas d'un voyage dans le temps ;
- le `décalage d'horloge serveur` affiché par le bilan donne l'ordre de grandeur de l'écart entre
  le poste MJ et le serveur Firebase ;
- surtout, **une latence de plusieurs secondes ne s'explique pas par une dérive d'horloge** entre
  deux machines synchronisées : c'est le seuil qui rend cette colonne concluante malgré son défaut.

Si « réseau » est petit, « attente rAF » courte et « vers la frame exécutée » énorme, la cause est
locale et la sonde de couches (touche P côté MJ) reprend la main. Si « réseau » se compte en
secondes, le sujet est Firebase — et la question
ouverte n°2 du CdC §12, « latence Firebase mesurée à table », trouve enfin sa réponse.
