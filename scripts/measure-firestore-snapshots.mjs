// @ts-check

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { measureFirestoreSnapshot } from '../js/transport/FirebaseTransport.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scenePath = path.join(root, 'maps', 'generated', 'testbig150.scene.json');
const campaign = JSON.parse(fs.readFileSync(scenePath, 'utf8'));

/** @param {string} name @param {object} candidate */
function report(name, candidate) {
  const measurement = measureFirestoreSnapshot(candidate, 'TEST1');
  const row = {
    campagne: name,
    jsonEncodeOctets: measurement.encodedJsonBytes,
    stockageFirestoreDocumenteOctets: measurement.firestoreEstimatedBytes,
    estimationPrudenteOctets: measurement.conservativeBytes,
    seuil: measurement.severity,
  };
  console.log(JSON.stringify(row));
}

const snapshot = {
  campaign,
  activeLevelId: campaign.levels[0]?.id || null,
  selectedTokenId: null,
  activeHandout: null,
};
report('testbig150', snapshot);

const threeLevels = structuredClone(campaign);
threeLevels.name = `${campaign.name} — synthétique 3 étages`;
threeLevels.levels = Array.from({ length: 3 }, (_, index) =>
  campaign.levels.map((/** @type {any} */ level) => ({
    ...structuredClone(level),
    id: `${level.id}-niveau-${index + 1}`,
    name: `${level.name} niveau ${index + 1}`,
    order: index,
  }))
).flat();
report('testbig150 × 3 étages synthétiques', {
  ...snapshot,
  campaign: threeLevels,
  activeLevelId: threeLevels.levels[0]?.id || null,
});
