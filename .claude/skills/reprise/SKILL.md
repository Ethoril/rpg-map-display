---
name: reprise
description: Ouvre une séance de travail sur ce dépôt — synchronisation git dans les deux sens, état réel d'avancement, décisions en attente. À lancer avant toute analyse ou tout développement.
---

# Reprise de séance

Le crochet `SessionStart` signale déjà l'écart avec `origin`. Ce skill va plus loin : il établit
**où en est le projet** et **ce qui attend une décision**, sans lire les 1 800 lignes de `ETAT.md`.

## 1. Git, dans les deux sens

```bash
git fetch --quiet && git status -sb && git rev-list --left-right --count origin/main...main
```

⚠ **Lire les deux nombres.** Les deux ont déjà coûté :

- **du retard** → on analyse un code périmé (11 commits une fois) ;
- **de l'avance non poussée** → ce travail n'existe pour aucune autre machine, et n'a donc été
  vérifié nulle part ailleurs (4 commits une fois).

Deux machines, Mac et poste Windows, synchronisées **par git seulement**. S'il y a de l'avance, le
dire — ne pas pousser sans demander.

## 2. L'état réel

Lire, dans cet ordre :

1. ⭐ **la table « Suite produit » de `docs/ETAT.md`** — elle **fait foi**. Le chapeau du même
   document a déjà dérivé jusqu'à annoncer « lot 2 pas commencé » trois jours après son début. En cas
   de désaccord entre les deux, la table gagne.
2. **`docs/QUESTIONS-EN-ATTENTE.md`** — ce qui attend un arbitrage du mainteneur. Certaines entrées
   sont des **défauts actifs**, pas des dettes dormantes : les distinguer.
3. Le dernier chantier ou brief mentionné comme en cours, s'il y en a un.

## 3. La porte, si on va toucher au code

```bash
pnpm run verify
```

⚠ Un unitaire s'ignore **selon la machine** : `realUvtt.test.mjs` s'auto-ignore quand
`fixtures/real/` est vide — et il l'est sur le poste Windows, le dossier étant gitignoré. Le corpus
UVTT réel n'existe que sur le Mac. Ailleurs, le parsing des exports réels n'est validé qu'en théorie.

## 4. Rapporter en cinq lignes

- l'écart git, dans les deux sens ;
- le décompte de la table « Suite produit » ;
- ce qui est en cours, ou « rien en cours » ;
- les décisions qui attendent le mainteneur ;
- l'état de la porte, si elle a été passée.

⛔ Ne pas enchaîner sur du développement sans que le mainteneur ait choisi quoi faire.
