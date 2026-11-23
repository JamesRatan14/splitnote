import { NaiveBayes } from './naiveBayes';
import { tokenize } from './tokenize';
import { Category, CATEGORIES, HistoryItem } from './types';
import type { PaymentMode } from '../../types';

/**
 * Cold-start training corpus. The classifier starts here and can be
 * personalised with the user's own labelled examples via `learn`.
 * (The evaluation set in evals/data/categories.json is disjoint from this corpus.)
 */
const SEED: Record<Category, string[]> = {
  'Food & Drink': [
    'dinner at restaurant', 'lunch pizza', 'coffee starbucks', 'brunch cafe', 'burger joint',
    'sushi night', 'tacos', 'bar drinks beer', 'ramen', 'chipotle burrito bowl', 'bubble tea boba',
    'breakfast diner', 'wings and pitchers', 'ice cream dessert', 'takeout thai food', 'happy hour cocktails',
    'doordash order', 'ubereats delivery', 'bakery pastries', 'steakhouse dinner',
  ],
  Groceries: [
    'groceries', 'wegmans', 'weekly grocery run', 'walmart supermarket', 'costco bulk', 'trader joes',
    'aldi vegetables', 'produce milk eggs', 'household supplies', 'instacart', 'snacks and water',
    'stop and shop', 'tops market', 'rice flour cooking essentials', 'cleaning supplies toiletries',
  ],
  Transport: [
    'uber ride', 'lyft', 'taxi cab', 'gas fuel station', 'bus pass', 'parking garage', 'train ticket amtrak',
    'toll', 'rental car', 'airport shuttle', 'metro subway fare', 'ride home', 'car wash', 'ev charging',
  ],
  Entertainment: [
    'movie tickets', 'cinema popcorn', 'concert', 'bowling', 'arcade games', 'netflix subscription',
    'spotify', 'escape room', 'karaoke', 'comedy show', 'theme park tickets', 'museum entry', 'game night',
    'sports game tickets', 'club cover charge', 'mini golf',
  ],
  Travel: [
    'flight tickets', 'hotel booking', 'airbnb stay', 'hostel', 'vacation rental', 'trip cabin',
    'airline baggage fee', 'resort', 'road trip lodging', 'weekend getaway', 'visa fee', 'tour guide',
  ],
  Shopping: [
    'amazon order', 'clothes', 'shoes sneakers', 'target', 'gift birthday present', 'electronics',
    'furniture ikea', 'mall', 'bestbuy', 'jacket', 'books', 'decor', 'phone case', 'backpack',
  ],
  Utilities: [
    'electricity bill', 'internet wifi', 'water bill', 'rent', 'gas heating bill', 'phone plan',
    'cable', 'trash service', 'renters insurance', 'laundry', 'apartment fee', 'maintenance repair',
  ],
  Other: [
    'misc', 'donation', 'tip', 'fine', 'printing', 'haircut', 'pharmacy', 'medical copay', 'course fee',
    'membership', 'lost item replacement',
  ],
};

export class CategoryClassifier {
  private nb = new NaiveBayes();

  constructor() {
    for (const cat of CATEGORIES) {
      for (const phrase of SEED[cat]) this.nb.train(tokenize(phrase), cat);
    }
  }

  /** Personalise with a user-confirmed example (weight = repeats, default 3 so it outweighs seed). */
  learn(title: string, category: Category, weight = 3): void {
    const toks = tokenize(title);
    for (let i = 0; i < weight; i++) this.nb.train(toks, category);
  }

  predict(title: string): { category: Category; confidence: number } {
    const toks = tokenize(title);
    const p = this.nb.predict(toks);
    // No known token -> don't pretend to know
    if (!p || !toks.some(t => this.nb.toJSON().vocab.includes(t))) {
      return { category: 'Other', confidence: 0 };
    }
    return { category: p.label as Category, confidence: p.probability };
  }
}

/**
 * Learns payment mode from the user's own history ("what do I usually pay with for X?").
 * Requires >= minHistory transactions; otherwise returns null.
 */
export function predictPaymentMode(
  title: string,
  history: HistoryItem[],
  minHistory = 10
): { mode: PaymentMode; confidence: number } | null {
  if (history.length < minHistory) return null;
  const nb = new NaiveBayes();
  for (const h of history) nb.train(tokenize(h.title), h.mode);
  const p = nb.predict(tokenize(title));
  return p ? { mode: p.label as PaymentMode, confidence: p.probability } : null;
}
