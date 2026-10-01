import { newId } from './ids';
import type { Cook } from '../types';

/** A new `Cook` row, with the same random-hue colour the other places that create one use. */
export function newCook(name: string): Cook {
  return { id: newId('cook'), name, color: `hsl(${Math.floor(Math.random() * 360)}, 45%, 40%)` };
}
