/**
 * The commission lifecycle, as data.
 *
 * Every state change in the system goes through assertTransition, so there is
 * exactly one place that says what may follow what and who may ask for it.
 * Money moves on two of these edges - `settle` and `refund` - and both are
 * reachable only from a state that has already been checked here.
 */

const STATES = {
  quoted:           'Priced, not yet paid',
  awaiting_payment: 'Buyer is completing payment',
  funded:           'Paid and held in escrow; licence awaiting signature',
  active:           'Licence executed by all three parties; painter at work',
  delivered:        'Painter has delivered; awaiting buyer confirmation',
  disputed:         'Buyer raised an issue; escrow held',
  accepted:         'Buyer confirmed delivery; escrow releasing',
  settled:          'Paid out, certificate issued',
  cancelled:        'Ended before payment',
  refunded:         'Ended after payment; buyer refunded',
};

const TERMINAL = ['settled', 'cancelled', 'refunded'];

/**
 * actors: who may request the action. 'system' means only the server does it -
 * on a payment webhook, a cron sweep, or immediately after another transition.
 */
const TRANSITIONS = {
  submit:        { from: ['quoted'],                        to: 'awaiting_payment', actors: ['buyer'] },
  fund:          { from: ['awaiting_payment'],              to: 'funded',           actors: ['system'] },
  activate:      { from: ['funded'],                        to: 'active',           actors: ['system'] },
  deliver:       { from: ['active'],                        to: 'delivered',        actors: ['painter'] },
  accept:        { from: ['delivered', 'disputed'],         to: 'accepted',         actors: ['buyer', 'system', 'admin'] },
  settle:        { from: ['accepted'],                      to: 'settled',          actors: ['system'] },
  dispute:       { from: ['active', 'delivered'],           to: 'disputed',         actors: ['buyer'] },
  cancel:        { from: ['quoted', 'awaiting_payment'],    to: 'cancelled',        actors: ['buyer', 'painter', 'admin'] },
  refund:        { from: ['funded', 'active', 'disputed'],  to: 'refunded',         actors: ['painter', 'buyer', 'admin'] },
};

function canTransition(action, fromState) {
  const rule = TRANSITIONS[action];
  return Boolean(rule && rule.from.includes(fromState));
}

/**
 * Throws with a message a user can act on. `actorRole` is the role this person
 * holds *on this commission* - buyer, painter, photographer, admin, or system.
 */
function assertTransition(action, fromState, actorRole) {
  const rule = TRANSITIONS[action];
  if (!rule) throw new Error(`Unknown action "${action}"`);

  if (!rule.from.includes(fromState)) {
    const readable = STATES[fromState] || fromState;
    throw new Error(`Cannot ${action} a commission that is ${fromState} (${readable})`);
  }
  if (actorRole !== 'admin' && !rule.actors.includes(actorRole)) {
    throw new Error(`A ${actorRole} cannot ${action} this commission`);
  }
  return rule.to;
}

/** Which actions this person could take right now - drives the UI's buttons. */
function availableActions(state, actorRole) {
  return Object.entries(TRANSITIONS)
    .filter(([, rule]) => rule.from.includes(state))
    .filter(([, rule]) => actorRole === 'admin' || rule.actors.includes(actorRole))
    .map(([action]) => action);
}

const isTerminal = state => TERMINAL.includes(state);

module.exports = { STATES, TRANSITIONS, TERMINAL, canTransition, assertTransition, availableActions, isTerminal };
