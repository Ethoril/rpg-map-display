# JOURNAL DU CHANTIER AUTONOME

> Tenu à chaque tranche et à chaque arrêt, selon `CHANTIER-AUTONOME.md` §4.
> Écrit pour quelqu'un qui reprend **sans contexte frais**. Un arrêt bien expliqué vaut mieux
> qu'une tranche mal finie.

---

## 18 août 2026 — mise en place, M1 relevée, M2 implémentée

### Ce qui a été fait

**Le dispositif.** `CLAUDE.md`, les skills `/muter` et `/reprise`, le crochet `SessionStart`, et
l'ouverture de `.gitignore` pour que tout cela atteigne l'autre poste. Trois commits sur `main`,
poussés, CI lancée. Branche `autonome/2026-08` créée depuis `09ef591`.

**La question du canal Claude → Gemini est close**, par quatre sondes toutes négatives : le CLI de
l'IDE n'injecte pas de prompt, le tier gratuit du CLI Gemini a été fermé par Google, Antigravity ne
déclare pas la capacité MCP `sampling`, et le SDK `google-antigravity` exige une clé facturée à
l'acte. ⛔ **Ne pas refaire ces sondes** — détail en mémoire, `canal_gemini_antigravity`.

Un guetteur de boîte aux lettres reste utilisable **quand le mainteneur est présent** :
`bridge/attendre-message.ps1` et `bridge/PROTOCOLE.md`. Une impulsion de sa part achète une longue
séance d'allers-retours. Hors git, jetable.

**⭐ M1 relevée, et c'est le grand acquis de la journée.** Le compositing du fog coûte **1580 à
1700 ms par image** sur la Tab S9 FE, `testbig150`, vue joueurs — **plat quel que soit le zoom**,
donc ~50 fois le budget de 33 ms. Chiffres complets dans `PLAN-SUITE.md` §1. Deux conséquences :
le fog basse résolution devient **prioritaire**, et le « petit lag résiduel » clos le 16/08 avait
cette cause.

**M2 implémentée** (section 16 de `diag.html`) par un sous-agent, puis **relue et mutée par un
autre**. Trois fonctions pures exportées de `js/app/diag.js` ; les tests assertent le **basculement
du verdict**, pas un nombre intermédiaire. Mutation revérifiée indépendamment : retirer la
soustraction du vidage de pipeline fait rougir le test, la restauration le rend vert.

### ⚠ Où exactement le travail s'est arrêté

**Épuisement des jetons, le 18/08 au soir.** L'arbre de `autonome/2026-08` porte, **non commités** :

- `diag.html`, `js/app/diag.js`, `tests/diagLightField.test.mjs` — la tranche M2 ;
- `docs/PLAN-SUITE.md` — la mesure M1 et les observations de terrain.

⚠ **`pnpm run verify` était en cours et son résultat n'a pas été lu.** Donc : **relancer la porte
avant de committer quoi que ce soit.** Ne pas se fier au vert rapporté par le sous-agent, ni à un
run antérieur — un premier passage a été contaminé (le fichier a été muté pendant qu'il tournait) et
doit être ignoré.

### Un point de vigilance sur M2

Pour rendre `diag.js` importable sous `node:test`, le câblage de fin de fichier a été enveloppé dans
`if (typeof document !== 'undefined')`. Vérifié : rien n'a disparu, tous les branchements sont
présents, et les e2e de `diag.spec.mjs` exercent la page. Mais c'est une modification du chemin réel
de la page pour un besoin de test — à regarder une fois de plus avant de committer.

### Ce qui attend, dans l'ordre

1. **Confirmer la porte, puis committer M2.**
2. **Instruire les deux régressions** de `PLAN-SUITE.md` §10 — l'import qui remplace sans demander,
   et le F5 nécessaire sur la tablette. Elles portent sur UX-13, livrée le matin même.
3. **Le fog basse résolution**, désormais prioritaire. Gros morceau : il mérite une session entière.

⛔ Aucune décision produit n'a été prise, et aucune ne doit l'être ici : modèle de lumière, sens de
`map_origin`, seuils de tuilage restent au mainteneur.

### ⚠ Deux pièges rencontrés en fin de séance, à ne pas refaire

**1. Un tube masque le code de sortie.** `pnpm run verify | tail -18` rend le code de `tail`, donc
**toujours 0** — le harnais annonçait « exit code 0 » sur une porte qui avait échoué. Capturer le
code réel : `pnpm run verify > sortie.txt 2>&1; echo "CODE=$?" >> sortie.txt`.

C'est la même famille que le `gemini -p` qui rend 0 malgré un échec d'authentification, rencontré le
même jour : **juger l'effet, jamais l'étiquette.**

**2. Ne jamais lancer deux `pnpm run verify` en parallèle.** Deux exécutions Playwright se disputent
le port du serveur et le dossier `test-results/`. Symptôme : « 43 passed » et une longue liste de
tests **non exécutés**, sans aucun échec nommé. Ce n'est pas une régression, c'est une collision —
nettoyer `test-results/` et relancer **seul**.
