// @ts-check
import assert from 'node:assert/strict';
import test from 'node:test';
import { createTemplateTools } from '../js/ui/gm/templateTools.js';

/**
 * Crée un conteneur HTML fictif minimal sans DOM lourd pour les tests unitaires.
 */
function createMockElement() {
  return {
    style: {},
    textContent: '',
    value: '',
    checked: false,
    addEventListener() {},
    getAttribute() { return null; },
  };
}

function createMockContainer() {
  /** @type {Map<string, any>} */
  const elements = new Map();
  return {
    /** @param {string} _val */
    set innerHTML(_val) {},
    /** @param {string} sel */
    querySelector(sel) {
      if (!elements.has(sel)) elements.set(sel, createMockElement());
      return elements.get(sel);
    },
    querySelectorAll() { return []; },
  };
}

test('G-02b : deux armements successifs produisent des identifiants distincts', () => {
  const container = createMockContainer();
  const realDateNow = Date.now;
  // Forcer Date.now() à renvoyer la même valeur pour simuler 2 armements dans la même ms
  Date.now = () => 1700000000000;

  try {
    const tools = createTemplateTools(/** @type {any} */ (container), {
      getActiveLevelId: () => 'level-1',
    });

    tools.setArmed(true);
    const id1 = tools.getConfig().templateId;

    tools.setArmed(false);
    tools.setArmed(true);
    const id2 = tools.getConfig().templateId;

    assert.notEqual(id1, id2, 'deux armements dans la même milliseconde doivent produire des identifiants différents');
  } finally {
    Date.now = realDateNow;
  }
});
