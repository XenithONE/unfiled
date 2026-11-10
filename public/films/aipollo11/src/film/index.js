// カットの登録（全編の順番はここで決まる）
import { Film } from './film.js';
import { debugShots } from './debug.js';
import { seq1 } from './seq1.js';
import { seq2 } from './seq2.js';
import { seq3 } from './seq3.js';
import { seq4 } from './seq4.js';
import { seq5 } from './seq5.js';

export function buildFilm(engine, world, qs) {
  const film = new Film(engine, world);
  if (qs.get('debug')) { debugShots(film, world, qs.get('debug')); return film; }
  seq1(film, world);
  seq2(film, world);
  seq3(film, world);
  seq4(film, world);
  seq5(film, world);
  return film;
}
