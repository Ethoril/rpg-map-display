// @ts-check

/** @typedef {import('../../core/types.js').Link} Link */
/** @typedef {import('../../core/types.js').Level} Level */
/** @typedef {import('../../grid/GridAdapter.js').GridAdapter} GridAdapter */

// ⛔ Prototype nul, et pas un objet littéral ordinaire. `kind` vient d'un import et n'est
// contraint par aucun validateur : une liaison de `kind: 'constructor'` ou `'toString'` ferait
// remonter la chaîne de prototypes et peindrait « function Object() { [native code] } » en travers
// de la carte, au lieu de retomber sur le symbole par défaut.
const LINK_SYMBOL = Object.freeze(Object.assign(Object.create(null), {
  stairs: '↕', elevator: '⇅', ladder: '⇵', hatch: '⇳', passage: '↔',
}));

/**
 * Invite au second tap, affichée aux joueurs quand le pion sélectionné est **posé sur** une
 * extrémité de liaison.
 *
 * ⭐ Le franchissement se fait en deux temps — amener le pion sur l'escalier, puis retaper sa
 * case — et c'est délibéré (`ui/player/bootstrap.js`). Mais rien ne le disait : à la séance du
 * 16 août 2026, les joueurs ont tapé l'escalier, vu leur personnage marcher jusque-là, et conclu
 * que la liaison ne marchait pas. Le mécanisme était intact ; c'est l'invitation qui manquait.
 *
 * ⛔ Ne pas « corriger » cela en franchissant au premier tap : on retomberait sur le défaut que
 * les deux temps évitent, c'est-à-dire changer d'étage chaque fois qu'on vise l'escalier pour
 * s'y poster, sous les yeux de toute la table.
 *
 * ⛔ Et ne pas déduire « monter » ou « descendre » de `level.order`. C'était la première version,
 * et elle disait faux : `order` est une clé de TRI D'AFFICHAGE — 0 par défaut, exposée par aucune
 * UI MJ, et `scripts/prepare-maps.mjs` la remplit avec l'index dans le pack. Un donjon dont le
 * pack liste la surface puis les sous-sols aurait affiché « monter » à qui descend. Le `kind`,
 * lui, est choisi à la main par le MJ dans l'éditeur de liaisons : il ne peut pas mentir.
 */
// Prototype nul pour la même raison que `LINK_SYMBOL` ci-dessus.
const LINK_PROMPT = Object.freeze(Object.assign(Object.create(null), {
  stairs: 'Retaper pour prendre l’escalier',
  elevator: 'Retaper pour prendre l’ascenseur',
  ladder: 'Retaper pour prendre l’échelle',
  hatch: 'Retaper pour passer la trappe',
  passage: 'Retaper pour prendre le passage',
}));
const LINK_PROMPT_DEFAUT = 'Retaper pour franchir';

/**
 * L'extrémité que les JOUEURS peuvent prendre depuis cet étage, s'il y en a une.
 *
 * ⚠ Doit rester l'exact équivalent de `store.findLinkAtCell` : une liaison MJ seule et l'entrée
 * B d'un sens unique ne se franchissent pas, et le tap les refuse. Ce qui est dessiné aux joueurs
 * est donc exactement ce qui est franchissable — sans quoi l'invite promettrait un geste que le
 * tap refuserait en silence, et le joueur retaperait indéfiniment.
 *
 * @param {Link} link
 * @param {string} levelId
 * @returns {import('../../core/types.js').LinkEndpoint|null}
 */
function extremiteJoueur(link, levelId) {
  if (link.gmOnly) return null;
  if (link.a.levelId === levelId) return link.a;
  if (link.b.levelId === levelId && link.bidirectional) return link.b;
  return null;
}

/** Rendu des extrémités de liaison. Le MJ obtient libellé et sens ; les joueurs un repère discret. */
export class LinksLayer {
  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {GridAdapter} grid
   * @param {Level} level
   * @param {Link[]} links
   * @param {{
   *   role?: 'gm'|'players',
   *   selectedLinkId?: string|null,
   *   zoom?: number,
   * }} [options]
   *
   * ⛔ Cette méthode ne connaît PAS l'invite de franchissement, et il ne faut pas l'y ramener.
   * Une première version teintait ici le repère en ambre quand le pion s'y tenait ; mesuré sur la
   * vue joueurs, le résultat était **identique octet pour octet** avant et après sélection. Le
   * disque fait 10 px écran de rayon au centre de la case, et le pion — qui remplit la case et se
   * dessine trois rangs plus haut — le recouvre intégralement. Trois ternaires qui ne peignaient
   * rien. Toute l'invite tient dans `renderPrompt`, au-dessus du brouillard.
   *
   * @returns {number}
   */
  render(ctx, grid, level, links, options = {}) {
    if (!ctx || !grid || !level || !Array.isArray(links)) return 0;
    const role = options.role ?? 'gm';
    const zoom = Math.max(0.01, options.zoom ?? 1);
    const radius = 10 / zoom;
    let rendered = 0;
    ctx.save();
    ctx.font = `${12 / zoom}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const link of links) {
      // Les joueurs ne voient que ce qu'ils peuvent prendre — liaison MJ et entrée B d'un sens
      // unique écartées par `extremiteJoueur`, partagée avec `renderPrompt` pour que les deux ne
      // puissent pas diverger. Le MJ, lui, voit les deux extrémités de tout.
      const endpoint =
        role === 'players'
          ? extremiteJoueur(link, level.id)
          : link.a.levelId === level.id
            ? link.a
            : link.b.levelId === level.id
              ? link.b
              : null;
      if (!endpoint) continue;
      const point = grid.pointFromCell({ a: endpoint.at.cellX, b: endpoint.at.cellY });
      const selected = role === 'gm' && options.selectedLinkId === link.id;
      ctx.save();
      ctx.globalAlpha = role === 'players' ? 0.48 : 0.9;
      ctx.fillStyle = selected ? '#f5a623' : '#2563eb';
      ctx.strokeStyle = selected ? '#fff7d6' : '#dbeafe';
      ctx.lineWidth = (selected ? 3 : 2) / zoom;
      ctx.beginPath();
      ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.fillText(LINK_SYMBOL[link.kind] ?? '↕', point.x, point.y + 0.5 / zoom);
      if (role === 'gm') {
        const direction = link.bidirectional ? '↔' : endpoint === link.a ? 'A→B' : 'B';
        const label = `${link.label || link.kind} ${direction}`;
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = '#111827';
        ctx.lineWidth = 3 / zoom;
        ctx.strokeText(label, point.x, point.y - 18 / zoom);
        ctx.fillText(label, point.x, point.y - 18 / zoom);
      }
      ctx.restore();
      rendered++;
    }
    ctx.restore();
    return rendered;
  }

  /**
   * Le TEXTE de l'invite de franchissement, à rendre **après le brouillard**.
   *
   * ⭐ Séparé de `render` pour cette seule raison, et il ne faut pas le rapatrier. Les liaisons
   * se dessinent au rang 5 de `CANVAS_LAYER_ORDER`, le fog au rang 9, et l'invite s'écrit
   * au-dessus de la case — donc dans la case du VOISIN, dont rien ne garantit qu'elle soit
   * explorée. Un escalier collé au mur nord d'une pièce a sa case du dessus derrière le mur : le
   * joueur voyait le repère, sur sa case éclairée, et aucun texte. Le correctif retombait dans le
   * silence qu'il corrige, et dans un cas courant.
   *
   * Ce n'est pas une fuite d'information, pour la raison déjà écrite au sujet du ping dans
   * `render/stage.js` : l'invite est ancrée sur la case où se tient le pion de ce joueur, donc
   * sur un endroit qu'il voit par construction. Elle ne révèle rien qu'il ne sache déjà.
   *
   * Effet de bord bienvenu : le texte échappe aussi à la teinte verte de la zone de déplacement,
   * qui se peint au rang 6.
   *
   * @param {CanvasRenderingContext2D} ctx
   * @param {GridAdapter} grid
   * @param {Level} level
   * @param {Link[]} links
   * @param {{zoom?: number, promptAtCell?: {a: number, b: number}|null}} [options]
   * @returns {number} 0 ou 1 — jamais plus, voir ci-dessous.
   */
  renderPrompt(ctx, grid, level, links, options = {}) {
    const promptAtCell = options.promptAtCell ?? null;
    if (!ctx || !grid || !level || !Array.isArray(links) || !promptAtCell) return 0;
    const zoom = Math.max(0.01, options.zoom ?? 1);

    // ⚠ UNE seule invite, la première trouvée. Rien n'interdit deux liaisons sur la même case du
    // même étage, et `store.findLinkAtCell` n'en rend qu'une — la première aussi. En dessiner
    // deux écrirait deux libellés l'un sur l'autre, illisibles, pour un seul franchissement
    // possible. Parcourir `links` dans le même ordre que le store est ce qui garantit que
    // l'invite affichée décrit bien la liaison que le tap prendra.
    for (const link of links) {
      const endpoint = extremiteJoueur(link, level.id);
      if (!endpoint) continue;
      if (endpoint.at.cellX !== promptAtCell.a || endpoint.at.cellY !== promptAtCell.b) continue;

      const point = grid.pointFromCell({ a: endpoint.at.cellX, b: endpoint.at.cellY });

      // Sortir de la case AVANT d'ajouter la marge : un décalage purement en pixels écran
      // écrirait l'invite en travers du pion — qui est justement posé là, c'est la condition même
      // de l'invite — et par-dessus son anneau de sélection.
      //
      // ⚠ Deux tiers du pas de ligne, et pas la moitié. La moitié est juste en carré et FAUSSE en
      // hexagonal : le pas de ligne odd-r vaut √3/2·px alors que la demi-hauteur d'un hexagone
      // pointe en haut vaut px/√3, soit exactement deux tiers du pas. À la moitié, l'invite
      // retombait dans l'hexagone dès le zoom 0,89. Le rapport 2/3 est exact en hexagonal et
      // simplement généreux en carré, où il laisse flotter le texte un sixième de case plus haut.
      const voisineDessus = grid.pointFromCell({
        a: endpoint.at.cellX,
        b: endpoint.at.cellY - 1,
      });
      const pasVertical = Math.abs(point.y - voisineDessus.y);
      const demiHauteur = pasVertical > 0 ? (pasVertical * 2) / 3 : 20 / zoom;

      // Tout le reste est en pixels ÉCRAN, divisé par le zoom : sans cela l'invite disparaîtrait
      // à la vue « carte entière » de la tablette (zoom 0,238). Plus grosse que le libellé MJ et
      // contournée de noir — le MJ lit son écran à 50 cm, la table lit une tablette posée au
      // milieu, sur un fond de carte qui peut être clair comme sombre.
      const labelY = point.y - demiHauteur - 18 / zoom;
      const label = LINK_PROMPT[link.kind] ?? LINK_PROMPT_DEFAUT;

      ctx.save();
      ctx.font = `600 ${15 / zoom}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#111827';
      ctx.lineWidth = 4 / zoom;
      ctx.strokeText(label, point.x, labelY);
      ctx.fillText(label, point.x, labelY);
      ctx.restore();
      return 1;
    }
    return 0;
  }
}
