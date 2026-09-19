import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeVoiceLeaks, describeOverlong, FOLLOWUP_BREVITY_RULES } from '../lib/claude-gen.js';

// 口吻检查的判例按真卡的形态写成合成句(真卡在 gitignore 的 nest/data 里,不进公开仓)。
// 校准数字见 claude-gen.js 的 VOICE_LEAK_PATTERNS 注释。

test('describeVoiceLeaks 报出三种她口吻的推测', () => {
  const leaks = describeVoiceLeaks([
    '这个开关我怀疑没人用过,它的调用方在哪?',
    '这说明我当时可能只读了 README?',
    '这个定性大概影响了我对它借鉴价值的判断,是吗?',
  ]);
  assert.equal(leaks.length, 3);
  assert.ok(leaks[0].startsWith('第 1 条') && leaks[2].startsWith('第 3 条'));
});

test('describeVoiceLeaks 不报正常提问:裸「大概」、她第一人称的提问、条末 Cobbler 猜', () => {
  // 修复后真卡里裸关键词「大概」3 次命中只有 1 次是真违规,下面两句是另外两种正常形态
  assert.deepEqual(describeVoiceLeaks([
    '每段大概要多少手工步骤?',
    '每块的维护代价大概在哪?',
    '请帮我核对:我这页记的是 v1.4.0,现在是哪一版?',
    '它的判据还成立吗?(Cobbler 猜:我怀疑早就改了)',
  ]), []);
});

test('describeVoiceLeaks / describeOverlong 对非数组、非字符串不抛', () => {
  assert.deepEqual(describeVoiceLeaks(null), []);
  assert.deepEqual(describeVoiceLeaks([1, null]), []);
  assert.deepEqual(describeOverlong(undefined), []);
});

test('describeOverlong 按字数报超长的那几条,默认 90 字', () => {
  const r = describeOverlong(['短问题?', '长'.repeat(91), '长'.repeat(90)]);
  assert.deepEqual(r, ['第 2 条 91 字']);
  assert.deepEqual(describeOverlong(['一二三四五'], 4), ['第 1 条 5 字']);
});

test('FOLLOWUP_BREVITY_RULES 要一句话、不要写透写长', () => {
  const t = FOLLOWUP_BREVITY_RULES.join('\n');
  assert.ok(t.includes('一句话') && t.includes('60 字') && t.includes('分量来自问得准'));
  assert.ok(!t.includes('长度不限'));
});
