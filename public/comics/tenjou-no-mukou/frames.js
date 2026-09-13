// Curated by actual distance and pose, not sheet order. No repeated cells or zoom tween.
// 35 individual drawings + the full-resolution final face/hand illustration.
const sequence = [
  [1,0,'奥で、頭を垂れている。'], [1,1,'肩が、震えた。'],
  [1,2,'髪の奥で、首が動く。'], [3,0,'両手が床を押す。'],
  [2,0,'顔が、こちらを向く。'], [1,3,'顎が上がる。'],
  [2,1,'目が合った。'], [3,1,'肘が外へ曲がる。'],
  [1,4,'片手が、前へ出る。'], [1,5,'指が床板を探る。'],
  [2,2,'もう片方の腕が伸びる。'], [3,2,'手のひらが、床をつかむ。'],
  [2,3,'胸が引き寄せられる。'], [1,6,'膝が、身体の下へ。'],
  [1,7,'両腕で身体を押す。'], [1,8,'髪を引きずり、這う。'],
  [2,4,'片手が床を離れる。'], [2,5,'前の板へ手をつく。'],
  [2,6,'身体が低く沈む。'], [3,3,'左手の指が浮く。'],
  [2,7,'膝を寄せる。'], [3,4,'肩が、前に飛び出す。'],
  [2,8,'口が開いた。'], [4,0,'腕が一気に伸びる。'],
  [4,1,'手のひらが、こちらへ。'], [3,6,'指を広げ、飛びかかる。'],
  [4,2,'顔が、目前に迫る。'], [4,3,'指先が折れ曲がる。'],
  [3,7,'空気をつかむ。'], [4,4,'喉の奥が震える。'],
  [4,5,'手が視界を覆い始める。'], [4,6,'もう、目を逸らせない。'],
  [3,8,'顔と片手が目の前へ。'], [4,7,'指が閉じてくる。'],
  [4,8,'すぐ、そこに。'], [0,0,'——つかまえた。'],
];

const cues = new Map([[4,'head'],[10,'step'],[16,'step'],[21,'step'],[25,'rush'],[35,'impact']]);
const approachSpeed = 1.3;
export const frames = sequence.map(([sheet,cell,caption], index) => ({
  sheet, cell, caption, cue: cues.get(index),
  // Speed up the approach to ~638ms; keep the final face/hand on screen for 560ms.
  hold: index === 35 ? 560 : (index < 8 ? 38 : index < 18 ? 26 : index < 27 ? 18 : 13) / approachSpeed,
}));

export const attackAssets = ['rush-1','rush-2','rush-3','rush-4','final'];
