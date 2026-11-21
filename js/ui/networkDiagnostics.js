// @ts-check

/** @typedef {import('../core/types.js').SyncIncident} SyncIncident */

const serviceLabels = { rtdb: 'Temps réel (RTDB)', firestore: 'Firestore', 'mj-link': 'Liaison outil MJ' };
const dateLabel = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'medium' });

/** @param {unknown} value @returns {SyncIncident[]} */
function readIncidents(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => item && Object.hasOwn(serviceLabels, item.channel) &&
    typeof item.operation === 'string' && item.operation.length <= 120 &&
    Number.isFinite(item.failedAt) && Math.abs(item.failedAt) <= 8.64e15 &&
    (item.recoveredAt === undefined || (Number.isFinite(item.recoveredAt) && Math.abs(item.recoveredAt) <= 8.64e15))
  ).slice(0, 3);
}

/** @param {'gm'|'players'} role @param {string} sessionId */
export function mountNetworkDiagnostics(role, sessionId) {
  const key = `rpg_sync_incidents_${sessionId}_${role}`;
  /** @type {SyncIncident[]} */
  let local = [];
  try { local = readIncidents(JSON.parse(localStorage.getItem(key) ?? '[]')); } catch { /* Stockage bloqué. */ }
  /** @type {SyncIncident[]} */
  let tablet = [];
  /** @type {((incidents: SyncIncident[]) => Promise<void>)|undefined} */
  let send;
  let transmitted = '';
  let sending = false;
  let destroyed = false;
  const panel = role === 'gm' ? document.createElement('details') : null;
  const list = document.createElement('ul');
  if (panel) {
    const summary = document.createElement('summary');
    summary.textContent = 'Incidents de synchronisation';
    panel.id = 'gm-sync-incidents';
    panel.hidden = true;
    panel.append(summary, list);
    document.body.appendChild(panel);
  }

  function render() {
    if (!panel) return;
    const records = [
      ...local.map((incident) => ({ ...incident, station: 'Poste MJ' })),
      ...tablet.map((incident) => ({ ...incident, station: 'Tablette' })),
    ].sort((a, b) => b.failedAt - a.failedAt);
    panel.hidden = records.length === 0;
    list.replaceChildren(...records.map((record) => {
      const line = document.createElement('li');
      const occurred = dateLabel.format(record.failedAt);
      const result = record.recoveredAt
        ? `${record.operation === 'Sauvegarde' ? 'Sauvegarde rétablie' : 'Rétabli'} à ${dateLabel.format(record.recoveredAt)}`
        : 'Échec constaté';
      line.textContent = `${occurred} · ${record.station} · ${serviceLabels[record.channel]} · ${record.operation} · ${result}`;
      return line;
    }));
  }

  async function flush() {
    if (!send || sending || destroyed || local.length === 0) return;
    const snapshot = local;
    const serialized = JSON.stringify(snapshot);
    if (serialized === transmitted) return;
    sending = true;
    try {
      await send(snapshot);
      transmitted = serialized;
    } catch {
      // L'incident reste sur cette tablette et sera retenté au prochain retour du canal.
    } finally {
      sending = false;
      if (snapshot !== local) void flush();
    }
  }

  /** @param {SyncIncident} incident */
  function save(incident) {
    local = [incident, ...local.filter(({ channel }) => channel !== incident.channel)];
    try { localStorage.setItem(key, JSON.stringify(local)); } catch { /* Garder la copie en mémoire. */ }
    render();
    void flush();
  }

  render();
  return {
    /** @param {SyncIncident['channel']} channel @param {string} operation */
    failed(channel, operation) {
      const last = local.find((item) => item.channel === channel);
      if (last?.operation === operation && !last.recoveredAt && Date.now() - last.failedAt < 500) return;
      save({ channel, operation, failedAt: Date.now() });
    },
    /** @param {SyncIncident['channel']} channel @param {string} operation */
    recovered(channel, operation) {
      const last = local.find((item) => item.channel === channel && item.operation === operation);
      if (last && !last.recoveredAt) save({ ...last, recoveredAt: Date.now() });
    },
    /** @param {unknown} detail */
    capture(detail) {
      const context = /** @type {{syncContext?: {channel: SyncIncident['channel'], operation: string}}|null} */ (detail)?.syncContext;
      if (context && Object.hasOwn(serviceLabels, context.channel) && typeof context.operation === 'string') {
        this.failed(context.channel, context.operation.slice(0, 120));
      }
    },
    /** @param {((incidents: SyncIncident[]) => Promise<void>)|undefined} sender */
    setSender(sender) { send = sender; void flush(); },
    /** @param {unknown} received */
    setTabletIncidents(received) { tablet = readIncidents(received); render(); },
    flush,
    destroy() { destroyed = true; panel?.remove(); },
  };
}
