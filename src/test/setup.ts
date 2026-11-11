import { readFileSync } from 'node:fs';
import { makeDb, setDb } from '../data/cardDb';

const json = JSON.parse(readFileSync(new URL('../../public/data/cards.json', import.meta.url), 'utf8'));
setDb(makeDb(json.cards, json.builtAt));
