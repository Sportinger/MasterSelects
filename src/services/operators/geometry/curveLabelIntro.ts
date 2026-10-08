/** Whole Unicode phrases preserve shaping; | separates cards and > separates language variants. */
export function parseCurveLabelIntro(value:string):string[][] {
  if(!value.trim())return [];
  if(value.length>512||/[\x00-\x1f\x7f]/.test(value))throw new Error('Curve Scan Labels: Intro Titles need at most 512 printable characters.');
  const cards=value.split('|').map(card=>card.split('>').map(word=>word.trim().toUpperCase()));
  if(cards.length>2||cards.some(card=>card.length>8||card.some(word=>!word||[...word].length>32)))
    throw new Error('Curve Scan Labels: Intro Titles support two cards (|), each with up to eight nonempty phrases (>) of 32 characters.');
  return cards;
}
