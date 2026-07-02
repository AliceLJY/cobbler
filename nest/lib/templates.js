export function truncate(s, n) {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

const MUTTERS = {
  calm: [
    '水又烧开了。你的代码还没编译完。',
    '我看了一天。真正的 bug 还是你写的那个循环。',
  ],
  happy: [
    '今天 commit 不少。我勉强承认有点顺。',
    '效率高得可疑。我检查过了,不是我的错觉。',
  ],
  sleepy: [
    '昨天一整天,一行都没有。我替你把日子看完了。',
    '安静得能听见水凉下去的声音。',
  ],
  grumbly: [
    '好几天了。水烧开又凉,烧开又凉。',
    '我写了点东西。你回来再看。',
  ],
};

const DIARY = [
  '今天也没等到你。我把你上个月的 bug 又想了一遍,还是你的问题。',
  '水开了三次。我数了数旧卡片,没什么新故事。',
  '有一行循环在我脑子里跑了一整天。不是我的,是你的。',
];

function pick(arr, rng) {
  return arr[Math.floor(rng() * arr.length)];
}

export function fallbackMutter(mood, rng = Math.random) {
  return pick(MUTTERS[mood] ?? MUTTERS.calm, rng);
}

export function fallbackDiary(rng = Math.random) {
  return pick(DIARY, rng);
}

export function fallbackCard(item, relTimeStr) {
  return {
    cardTitle: `${relTimeStr},你在折腾「${truncate(item.title, 24)}」`,
    cardBody: truncate(item.detail || item.title, 100),
  };
}
