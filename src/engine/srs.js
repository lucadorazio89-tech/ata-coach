// Spaced repetition stile SM-2, semplificato e prevedibile.
// grade: 0 = sbagliata, 1 = giusta ma incerta/tirata a indovinare, 2 = giusta e sicura.
import { DAY } from '../core/util.js';

export function newCard(now = Date.now()) { return { ease: 2.3, interval: 0, due: now, reps: 0, lapses: 0, streak: 0, last: null }; }

export function reviewCard(card, grade, now = Date.now()) {
  const c = { ...card };
  if (grade === 0) {
    c.lapses++; c.streak = 0; c.reps++;
    c.ease = Math.max(1.3, c.ease - 0.2);
    c.interval = 1;                                  // si rivede domani
  } else {
    c.reps++; c.streak++;
    if (grade === 1) { c.ease = Math.max(1.3, c.ease - 0.05); c.interval = c.interval < 1 ? 1 : Math.max(1, Math.round(c.interval * 1.2)); }
    else { c.interval = c.interval < 1 ? 1 : c.interval < 3 ? 3 : Math.round(c.interval * c.ease); }
  }
  c.interval = Math.min(c.interval, 120);
  c.last = now;
  c.due = now + c.interval * DAY;
  return c;
}

export function isDue(card, now = Date.now()) { return card && card.reps > 0 && card.due <= now; }
export function overdueDays(card, now = Date.now()) { return Math.max(0, (now - card.due) / DAY); }

export function dueQuestionIds(state, now = Date.now()) {
  return Object.entries(state.cards).filter(([, c]) => isDue(c, now))
    .sort((a, b) => overdueDays(b[1], now) - overdueDays(a[1], now)).map(([id]) => id);
}
