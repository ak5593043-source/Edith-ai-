import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GROQ_AUTOMATION_TOOLS,
  validateAndSanitizeToolCall,
  buildFallbackAutomationPlan,
  extractPlanFromGroqToolCalls,
} from './automationTools.ts';

test('GROQ_AUTOMATION_TOOLS exposes exactly the 8 allowlisted automation tools', () => {
  const names = GROQ_AUTOMATION_TOOLS.map((t) => t.function.name).sort();
  assert.deepEqual(names, [
    'enter_text',
    'execute_task_plan',
    'get_screen_information',
    'open_app',
    'open_url',
    'scroll_screen',
    'search_text',
    'tap_element',
  ]);
});

test('validateAndSanitizeToolCall blocks non-allowlisted arbitrary shell/eval tools', () => {
  const res = validateAndSanitizeToolCall('run_shell_command', { cmd: 'rm -rf /' });
  assert.equal(res.valid, false);
  assert.match(res.error || '', /Blocked non-allowlisted/);
});

test('validateAndSanitizeToolCall blocks javascript: URLs and security/CAPTCHA bypass attempts', () => {
  const jsUrl = validateAndSanitizeToolCall('open_url', { url: 'javascript:alert(1)' });
  assert.equal(jsUrl.valid, false);
  assert.match(jsUrl.error || '', /unsafe URL scheme/);

  const bypass = validateAndSanitizeToolCall('search_text', { query: 'how to bypass captcha login 2fa' });
  assert.equal(bypass.valid, false);
  assert.match(bypass.error || '', /security bypass/i);
});

test('assessToolSensitivity flags outbound Send/Pay/Delete taps and sensitive tel:/wa.me URLs', () => {
  const tapSend = validateAndSanitizeToolCall('tap_element', { text: 'Send Message' });
  assert.equal(tapSend.valid, true);
  assert.equal(tapSend.isSensitive, true);

  const callUrl = validateAndSanitizeToolCall('open_url', { url: 'tel:+919876543210' });
  assert.equal(callUrl.valid, true);
  assert.equal(callUrl.isSensitive, true);

  const safeScroll = validateAndSanitizeToolCall('scroll_screen', { direction: 'down', steps: 2 });
  assert.equal(safeScroll.valid, true);
  assert.equal(safeScroll.isSensitive, false);
});

test('buildFallbackAutomationPlan decomposes multi-step commands cleanly', () => {
  const igPlan = buildFallbackAutomationPlan('Open Instagram and search for nasa');
  assert.ok(igPlan.steps.length >= 4);
  assert.equal(igPlan.steps[0].tool, 'open_app');
  assert.equal(igPlan.steps[0].arguments.packageName, 'com.instagram.android');
  assert.ok(igPlan.steps.some((s) => s.tool === 'enter_text' && s.arguments.text === 'nasa'));
  assert.ok(igPlan.steps.some((s) => s.tool === 'get_screen_information'));

  const settingsPlan = buildFallbackAutomationPlan('Open Settings and navigate to WiFi');
  assert.equal(settingsPlan.steps[0].tool, 'open_app');
  assert.equal(settingsPlan.steps[0].arguments.packageName, 'com.android.settings');
  assert.equal(settingsPlan.steps[0].arguments.targetScreen, 'wifi');
  assert.ok(settingsPlan.steps.some((s) => s.tool === 'tap_element' && /wifi/i.test(s.arguments.text)));
});

test('extractPlanFromGroqToolCalls validates Groq execute_task_plan JSON arguments and drops unsafe steps', () => {
  const result = extractPlanFromGroqToolCalls(
    [
      {
        function: {
          name: 'execute_task_plan',
          arguments: JSON.stringify({
            goal: 'Search YouTube for Lo-fi beats',
            steps: [
              {
                tool: 'open_app',
                title: 'Open YouTube',
                arguments: { appName: 'YouTube' },
              },
              {
                tool: 'exec_bash',
                title: 'Unsafe injection',
                arguments: { cmd: 'whoami' },
              },
              {
                tool: 'search_text',
                title: 'Search YouTube',
                arguments: { query: 'Lo-fi beats', targetApp: 'youtube' },
              },
            ],
          }),
        },
      },
    ],
    'Open YouTube and search Lo-fi beats'
  );

  assert.equal(result.usedGroqTools, true);
  assert.equal(result.steps.length, 2);
  assert.equal(result.steps[0].arguments.packageName, 'com.google.android.youtube');
  assert.equal(result.steps[1].tool, 'search_text');
});
