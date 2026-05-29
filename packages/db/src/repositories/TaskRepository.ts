// packages/db/src/repositories/TaskRepository.ts

import { eq, desc, and, inArray } from 'drizzle-orm';
import { getDb, schema } from '../client.js';
import type { Task, SubTask, TaskInput } from '@omni/core';
import { randomUUID } from 'crypto';

type DbTask = typeof schema.tasks.$inferSelect;
type DbSubtask = typeof schema.subtasks.$inferSelect;

export class TaskRepository {
  private get db() {
    return getDb();
  }

  async create(input: TaskInput): Promise<Task> {
    const id = randomUUID();
    const now = new Date();

    await this.db.insert(schema.tasks).values({
      id,
      status: 'pending',
      priority: 'normal',
      executionMode: input.executionMode,
      modelId: input.modelId,
      inputPrompt: input.prompt,
      inputMessagesJson: JSON.stringify(input.messages),
      inputSystemContext: input.systemContext ?? null,
      hasImages: (input.images?.length ?? 0) > 0,
      createdAt: now,
      updatedAt: now,
    });

    return this.findById(id) as Promise<Task>;
  }

  async findById(id: string): Promise<Task | null> {
    const rows = await this.db
      .select()
      .from(schema.tasks)
      .where(eq(schema.tasks.id, id))
      .limit(1);

    const row = rows[0];
    if (!row) return null;

    const subtaskRows = await this.db
      .select()
      .from(schema.subtasks)
      .where(eq(schema.subtasks.parentTaskId, id));

    return this.toTask(row, subtaskRows);
  }

  async updateStatus(
    id: string,
    status: Task['status'],
    extras?: Partial<{
      finalOutput: string;
      error: string;
      planJson: string;
      evaluationJson: string;
    }>,
  ): Promise<void> {
    const now = new Date();
    const completedAt =
      status === 'completed' || status === 'failed' || status === 'cancelled'
        ? now
        : undefined;

    await this.db
      .update(schema.tasks)
      .set({
        status,
        updatedAt: now,
        ...(completedAt ? { completedAt } : {}),
        ...(extras?.finalOutput !== undefined
          ? { finalOutput: extras.finalOutput }
          : {}),
        ...(extras?.error !== undefined ? { error: extras.error } : {}),
        ...(extras?.planJson !== undefined ? { planJson: extras.planJson } : {}),
        ...(extras?.evaluationJson !== undefined
          ? { evaluationJson: extras.evaluationJson }
          : {}),
      })
      .where(eq(schema.tasks.id, id));
  }

  async createSubtask(
    parentTaskId: string,
    data: Pick<SubTask, 'role' | 'assignedProvider' | 'prompt' | 'maxRetries'>,
  ): Promise<SubTask> {
    const id = randomUUID();
    const now = new Date();

    await this.db.insert(schema.subtasks).values({
      id,
      parentTaskId,
      role: data.role,
      assignedProvider: data.assignedProvider,
      prompt: data.prompt,
      status: 'pending',
      retries: 0,
      maxRetries: data.maxRetries,
      createdAt: now,
    });

    const rows = await this.db
      .select()
      .from(schema.subtasks)
      .where(eq(schema.subtasks.id, id))
      .limit(1);

    return this.toSubTask(rows[0]!);
  }

  async updateSubtask(
    id: string,
    data: Partial<{
      status: typeof schema.subtasks.$inferInsert.status;
      resultContent: string;
      resultMetaJson: string;
      durationMs: number;
      tokensEstimate: number;
      retries: number;
      error: string;
      startedAt: Date;
      completedAt: Date;
    }>,
  ): Promise<void> {
    const updateData = {
      ...(data.status !== undefined ? { status: data.status } : {}),
      ...(data.resultContent !== undefined ? { resultContent: data.resultContent } : {}),
      ...(data.resultMetaJson !== undefined ? { resultMetaJson: data.resultMetaJson } : {}),
      ...(data.durationMs !== undefined ? { durationMs: data.durationMs } : {}),
      ...(data.tokensEstimate !== undefined ? { tokensEstimate: data.tokensEstimate } : {}),
      ...(data.retries !== undefined ? { retries: data.retries } : {}),
      ...(data.error !== undefined ? { error: data.error } : {}),
      ...(data.startedAt !== undefined ? { startedAt: data.startedAt } : {}),
      ...(data.completedAt !== undefined ? { completedAt: data.completedAt } : {}),
    };

    await this.db
      .update(schema.subtasks)
      .set(updateData)
      .where(eq(schema.subtasks.id, id));
  }

  async listRecent(limit = 50): Promise<Task[]> {
    const rows = await this.db
      .select()
      .from(schema.tasks)
      .orderBy(desc(schema.tasks.createdAt))
      .limit(limit);

    const taskIds = rows.map((r) => r.id);
    if (taskIds.length === 0) return [];

    const subtaskRows = await this.db
      .select()
      .from(schema.subtasks)
      .where(inArray(schema.subtasks.parentTaskId, taskIds));

    return rows.map((row) =>
      this.toTask(
        row,
        subtaskRows.filter((s) => s.parentTaskId === row.id),
      ),
    );
  }

  // ─── Mappers ───────────────────────────────────────────────────────────────

  private toTask(row: DbTask, subtaskRows: DbSubtask[]): Task {
    const input: TaskInput = {
      prompt: row.inputPrompt,
      messages: JSON.parse(row.inputMessagesJson),
      executionMode: row.executionMode,
      modelId: row.modelId,
      ...(row.inputSystemContext ? { systemContext: row.inputSystemContext } : {}),
    };

    const task: Task = {
      id: row.id,
      input,
      status: row.status as Task['status'],
      priority: row.priority as Task['priority'],
      subtasks: subtaskRows.map((s) => this.toSubTask(s)),
      streamingChunks: [],
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      ...(row.planJson ? { plan: JSON.parse(row.planJson) } : {}),
      ...(row.evaluationJson ? { evaluation: JSON.parse(row.evaluationJson) } : {}),
      ...(row.finalOutput ? { finalOutput: row.finalOutput } : {}),
      ...(row.error ? { error: row.error } : {}),
      ...(row.completedAt ? { completedAt: row.completedAt } : {}),
    };

    return task;
  }

  private toSubTask(row: DbSubtask): SubTask {
    const subtask: SubTask = {
      id: row.id,
      parentTaskId: row.parentTaskId,
      role: row.role,
      assignedProvider: row.assignedProvider,
      prompt: row.prompt,
      status: row.status as SubTask['status'],
      retries: row.retries,
      maxRetries: row.maxRetries,
      createdAt: row.createdAt,
      ...(row.error ? { error: row.error } : {}),
      ...(row.startedAt ? { startedAt: row.startedAt } : {}),
      ...(row.completedAt ? { completedAt: row.completedAt } : {}),
    };

    return subtask;
  }
}
