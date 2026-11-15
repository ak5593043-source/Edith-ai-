import React, { useState, useRef, useEffect } from 'react';
import {
  ListChecks,
  Play,
  Square,
  CheckCircle2,
  Circle,
  Loader2,
  ExternalLink,
  RotateCcw,
  StepForward,
} from 'lucide-react';
import { TaskPlan, TaskStep } from '../types/chat.ts';
import { executeDeviceAction } from '../utils/actionDispatcher.ts';
import { computePlanProgress, getNextPendingStep, markStepStatus } from '../utils/commandPlanner.ts';

interface TaskPipelineCardProps {
  plan: TaskPlan;
  onPlanUpdate?: (updated: TaskPlan) => void;
  onTriggerPdfDownload?: () => void;
}

export const TaskPipelineCard: React.FC<TaskPipelineCardProps> = ({
  plan: initialPlan,
  onPlanUpdate,
  onTriggerPdfDownload,
}) => {
  const [plan, setPlan] = useState<TaskPlan>(initialPlan);
  const [isAutoRunning, setIsAutoRunning] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const stopAutoRef = useRef(false);

  // Sync if parent passes an updated plan (e.g. from persistence or newly resolved steps)
  useEffect(() => {
    setPlan(initialPlan);
  }, [initialPlan]);

  useEffect(() => {
    return () => {
      stopAutoRef.current = true;
    };
  }, []);

  const commitPlan = (next: TaskPlan) => {
    setPlan(next);
    if (onPlanUpdate) onPlanUpdate(next);
  };

  const progress = computePlanProgress(plan);
  const nextStep = getNextPendingStep(plan);

  const runSingleStep = async (step: TaskStep, currentPlan: TaskPlan): Promise<TaskPlan> => {
    const runningPlan = markStepStatus(currentPlan, step.id, 'running');
    commitPlan(runningPlan);

    if (step.action) {
      const res = await executeDeviceAction(step.action, true);
      setStatusMessage(`Step ${step.order}: ${res.message}`);
    } else if (step.type === 'pdf' && onTriggerPdfDownload) {
      onTriggerPdfDownload();
      setStatusMessage(`Step ${step.order}: Triggered PDF download.`);
    } else {
      setStatusMessage(`Step ${step.order}: Completed "${step.title}".`);
    }

    const donePlan = markStepStatus(runningPlan, step.id, 'completed');
    commitPlan(donePlan);
    return donePlan;
  };

  const handleRunStep = async (step: TaskStep) => {
    await runSingleStep(step, plan);
  };

  const handleToggleDone = (step: TaskStep) => {
    const nextStatus = step.status === 'completed' ? 'pending' : 'completed';
    const next = markStepStatus(plan, step.id, nextStatus);
    commitPlan(next);
  };

  const handleRunNext = async () => {
    if (!nextStep) return;
    await runSingleStep(nextStep, plan);
  };

  const handleRunAll = async () => {
    if (isAutoRunning) {
      stopAutoRef.current = true;
      setIsAutoRunning(false);
      setStatusMessage('Sequential auto-run paused.');
      return;
    }

    stopAutoRef.current = false;
    setIsAutoRunning(true);
    let workingPlan = plan;

    const pendingSteps = workingPlan.steps.filter((s) => s.status !== 'completed' && s.status !== 'skipped');
    for (let i = 0; i < pendingSteps.length; i++) {
      if (stopAutoRef.current) break;
      workingPlan = await runSingleStep(pendingSteps[i], workingPlan);
      if (i < pendingSteps.length - 1 && !stopAutoRef.current) {
        await new Promise((resolve) => setTimeout(resolve, 950));
      }
    }

    setIsAutoRunning(false);
    if (!stopAutoRef.current) {
      setStatusMessage(`All ${workingPlan.steps.length} steps completed!`);
    }
  };

  const handleResetPlan = () => {
    stopAutoRef.current = true;
    setIsAutoRunning(false);
    setStatusMessage(null);
    const reset: TaskPlan = {
      ...plan,
      steps: plan.steps.map((s) => ({
        ...s,
        status: 'pending',
        action: s.action ? { ...s.action, executed: false } : undefined,
      })),
    };
    commitPlan(reset);
  };

  return (
    <div
      data-testid="task-pipeline-card"
      className="my-3 w-full max-w-xl rounded-2xl bg-[#0c0f17] border border-blue-500/35 p-4 shadow-xl shadow-black/70 text-left select-text"
    >
      {/* Planner Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-white/10">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-blue-600/20 border border-blue-500/40 text-blue-300">
            <ListChecks className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h4 className="font-semibold text-xs sm:text-sm text-white truncate">
              Command Plan ({plan.steps.length} Steps Noted)
            </h4>
            <p className="text-[11px] text-[#A1A1AA] truncate">{plan.goal}</p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-[11px] font-mono font-semibold px-2 py-0.5 rounded-full bg-blue-950/70 border border-blue-700/50 text-blue-300">
            {progress.completed}/{progress.total} Done
          </span>
          {progress.completed > 0 && (
            <button
              type="button"
              onClick={handleResetPlan}
              title="Reset all steps"
              aria-label="Reset command plan steps"
              className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/5 hover:bg-white/10 text-[#A1A1AA] hover:text-white transition-colors"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Progress Bar */}
      <div className="mt-3 mb-3 h-1.5 w-full rounded-full bg-[#181c28] overflow-hidden">
        <div
          className="h-full rounded-full bg-gradient-to-r from-blue-500 to-emerald-400 transition-all duration-300"
          style={{ width: `${progress.percent}%` }}
        />
      </div>

      {/* Primary Sequential Controls */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <button
          type="button"
          onClick={handleRunAll}
          disabled={progress.pending === 0 && !isAutoRunning}
          className={`flex items-center gap-1.5 rounded-xl px-3.5 py-1.5 text-xs font-semibold transition-all ${
            isAutoRunning
              ? 'bg-red-600 hover:bg-red-500 text-white'
              : progress.pending === 0
              ? 'bg-emerald-950/60 border border-emerald-700/50 text-emerald-300 cursor-default'
              : 'bg-blue-600 hover:bg-blue-500 text-white shadow-md shadow-blue-900/40'
          }`}
        >
          {isAutoRunning ? (
            <>
              <Square className="h-3 w-3 fill-white" />
              <span>Pause Auto-Run</span>
            </>
          ) : progress.pending === 0 ? (
            <>
              <CheckCircle2 className="h-3.5 w-3.5" />
              <span>All {progress.total} Steps Completed</span>
            </>
          ) : (
            <>
              <Play className="h-3 w-3 fill-white" />
              <span>Run All {progress.pending} Remaining Steps</span>
            </>
          )}
        </button>

        {nextStep && !isAutoRunning && (
          <button
            type="button"
            onClick={handleRunNext}
            className="flex items-center gap-1.5 rounded-xl bg-white/8 hover:bg-white/15 border border-white/10 px-3 py-1.5 text-xs font-medium text-white transition-colors"
          >
            <StepForward className="h-3.5 w-3.5 text-blue-400" />
            <span>Run Step {nextStep.order}</span>
          </button>
        )}
      </div>

      {/* Ordered Unlimited Checklist */}
      <ol className="space-y-1.5">
        {plan.steps.map((step) => {
          const isDone = step.status === 'completed';
          const isRunning = step.status === 'running';
          return (
            <li
              key={step.id}
              data-step-status={step.status}
              className={`flex items-center justify-between gap-2.5 rounded-xl border px-3 py-2 transition-colors ${
                isRunning
                  ? 'bg-blue-950/40 border-blue-500/60'
                  : isDone
                  ? 'bg-emerald-950/20 border-emerald-800/40'
                  : 'bg-[#121622] border-white/10'
              }`}
            >
              <div className="flex items-start gap-2.5 min-w-0">
                <button
                  type="button"
                  onClick={() => handleToggleDone(step)}
                  aria-label={`Toggle step ${step.order} complete`}
                  className="mt-0.5 shrink-0 text-[#A1A1AA] hover:text-white transition-colors"
                >
                  {isRunning ? (
                    <Loader2 className="h-4 w-4 animate-spin text-blue-400" />
                  ) : isDone ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                  ) : (
                    <Circle className="h-4 w-4 text-[#71717A]" />
                  )}
                </button>

                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[10px] font-mono text-blue-400 font-semibold">
                      #{step.order}
                    </span>
                    <span
                      className={`text-xs font-medium ${
                        isDone ? 'text-[#A1A1AA] line-through' : 'text-white'
                      }`}
                    >
                      {step.title}
                    </span>
                  </div>
                  {step.detail && (
                    <p className="text-[10px] text-[#8E8E93] truncate max-w-xs sm:max-w-sm">
                      {step.detail}
                    </p>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                {(step.action || step.type === 'pdf') && (
                  <button
                    type="button"
                    onClick={() => handleRunStep(step)}
                    aria-label={`Run step ${step.order}: ${step.title}`}
                    className={`flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                      isDone
                        ? 'bg-white/5 hover:bg-white/10 text-[#D4D4D8]'
                        : 'bg-blue-600/80 hover:bg-blue-500 text-white'
                    }`}
                  >
                    <ExternalLink className="h-3 w-3" />
                    <span>{step.action ? 'Open' : 'PDF'}</span>
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      {statusMessage && (
        <div className="mt-2.5 text-[11px] text-emerald-300 font-medium">
          {statusMessage}
        </div>
      )}
    </div>
  );
};
