import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractTaskPlan,
  parseCommandIntoSteps,
  markStepStatus,
  getNextPendingStep,
  computePlanProgress,
  stripRawTaskPlanTags,
} from './commandPlanner';

test('parseCommandIntoSteps notes 6 distinct steps from a long multi-step Hinglish command without capping at 2', () => {
  const cmd =
    '1. WhatsApp par 9876543210 ko "Meeting at 5" bhejo\n2. YouTube par focus music chalao\n3. Instagram reels kholo\n4. Google Maps par Connaught Place ka rasta dikhao\n5. Quantum physics notes ka PDF bana do\n6. Spotify par Arijit Singh play karo';

  const steps = parseCommandIntoSteps(cmd);
  assert.equal(steps.length, 6);
  assert.equal(steps[0].type, 'app');
  assert.equal(steps[0].action?.type, 'whatsapp_message');
  assert.equal(steps[1].action?.type, 'youtube_search');
  assert.equal(steps[2].action?.type, 'instagram_reels');
  assert.equal(steps[3].action?.type, 'maps_search');
  assert.equal(steps[4].type, 'pdf');
  assert.equal(steps[5].action?.type, 'spotify_play');
});

test('extractTaskPlan parses AI [TASK_PLAN:{...}] tag with 5 steps, strips tag cleanly, and binds deep links', () => {
  const aiResponse = [
    'Maine aapke 5-step command ko note karke sequence me ready kar diya hai.',
    '[TASK_PLAN:{"goal":"5-Step Daily Routine","steps":[{"title":"Send WhatsApp to Rahul","type":"app","action":{"type":"whatsapp_message","appName":"WhatsApp","target":"919876543210","message":"Good morning","webUrl":"https://wa.me/919876543210?text=Good%20morning"}},{"title":"Open YouTube Coding Music","type":"app","action":{"type":"youtube_search","appName":"YouTube","webUrl":"https://www.youtube.com/results?search_query=coding+music"}},{"title":"Open Instagram Reels","type":"app","action":{"type":"instagram_reels","appName":"Instagram","webUrl":"https://www.instagram.com/reels/"}},{"title":"Open Spotify","type":"app","action":{"type":"spotify_play","appName":"Spotify","webUrl":"https://open.spotify.com/"}},{"title":"Navigate to Office","type":"app","action":{"type":"maps_search","appName":"Google Maps","webUrl":"https://www.google.com/maps"}}]}]',
  ].join('\n');

  const { cleanText, plan } = extractTaskPlan(aiResponse, '5 step routine');
  assert.equal(cleanText, 'Maine aapke 5-step command ko note karke sequence me ready kar diya hai.');
  assert.ok(plan);
  assert.equal(plan.goal, '5-Step Daily Routine');
  assert.equal(plan.steps.length, 5);
  assert.equal(plan.steps[0].order, 1);
  assert.equal(plan.steps[4].order, 5);
  assert.equal(plan.steps[0].action?.androidPackage, 'com.whatsapp');
});

test('extractTaskPlan backfills missing steps when user gave 4 steps even if AI only noted 2', () => {
  const userCmd = 'open YouTube, Instagram, Spotify and Telegram';
  const truncatedAiPlan =
    'Done!\n[TASK_PLAN:{"goal":"Open apps","steps":[{"title":"Open YouTube","type":"app"},{"title":"Open Instagram","type":"app"}]}]';

  const { plan } = extractTaskPlan(truncatedAiPlan, userCmd);
  assert.ok(plan);
  assert.equal(plan.steps.length, 4);
  assert.equal(plan.steps[2].action?.type, 'spotify_play');
  assert.equal(plan.steps[3].action?.type, 'telegram_open');
});

test('markStepStatus, getNextPendingStep, and computePlanProgress track sequential progress accurately', () => {
  const steps = parseCommandIntoSteps('open YouTube and Instagram and Spotify and Telegram');
  let plan = { id: 'p1', goal: 'Test 4 steps', steps };

  assert.equal(computePlanProgress(plan).percent, 0);
  assert.equal(getNextPendingStep(plan)?.id, steps[0].id);

  plan = markStepStatus(plan, steps[0].id, 'completed');
  plan = markStepStatus(plan, steps[1].id, 'completed');

  const prog = computePlanProgress(plan);
  assert.equal(prog.completed, 2);
  assert.equal(prog.pending, 2);
  assert.equal(prog.percent, 50);
  assert.equal(getNextPendingStep(plan)?.id, steps[2].id);
});

test('stripRawTaskPlanTags removes incomplete streaming [TASK_PLAN fragment safely', () => {
  const partial = 'Preparing your command plan...\n[TASK_PLAN:{"goal":"Test","steps":[{"title":"Step 1"';
  assert.equal(stripRawTaskPlanTags(partial), 'Preparing your command plan...');
});
