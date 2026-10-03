import {
  ExamStageChangeSchema,
  IdSchema,
  MarkSheetKeySchema,
  MarkSheetSaveSchema,
  MarkSheetSubmitSchema,
  MarkSheetUnlockSchema,
  ResultExamQuerySchema,
  SheetTeacherInputSchema,
} from '@ttlmhss/shared';
import { z } from 'zod';
import type { AppDependencies } from '../../app-dependencies.js';
import { requires } from '../../core/auth/access.js';
import type { FeatureModule } from '../../core/http/module.js';
import { defineRoute, type RouteContext } from '../../core/http/routes.js';
import { MarkSheetService } from './mark-sheet.service.js';
import { MarksAdminService } from './marks-admin.service.js';
import type { RequestContext } from './marks-context.js';
import { ResultsService } from './results.service.js';

const ctxOf = (c: RouteContext<unknown, unknown, unknown>): RequestContext => ({
  principal: c.principal,
  requestId: c.request.id,
});

const ExamParam = z.object({ examId: IdSchema });
const SheetParams = z.object({ examSubjectId: IdSchema, sectionId: IdSchema });

/**
 * Exams, marks and results (Phase 8B).
 *   /admin/exams/:examId/…     exam lifecycle, mark-sheet matrix, teacher authorisation (exams.manage)
 *   /marks/…                   mark sheets: view, Save draft, Submit, Unlock, history (marks.view +
 *                              per-sheet authorisation in MarkSheetService)
 *   /results/…                 results (results.view; students: own only)
 */
export function marksModule(deps: AppDependencies): FeatureModule {
  const base = { dataStore: deps.dataStore, clock: deps.clock, authorization: deps.authorization };
  const admin = new MarksAdminService(base);
  const sheets = new MarkSheetService(base);
  const results = new ResultsService(base);
  return {
    name: 'marks',
    routes: [
      // ---- Administration ------------------------------------------------------------------
      defineRoute({
        method: 'GET',
        url: '/admin/exams/:examId/mark-sheets',
        access: requires('exams.manage'),
        schema: { params: ExamParam },
        handler: (c) => admin.matrix(ctxOf(c), c.params.examId),
      }),
      defineRoute({
        method: 'PUT',
        url: '/admin/exams/:examId/stage',
        access: requires('exams.manage'),
        schema: { params: ExamParam, body: ExamStageChangeSchema },
        handler: (c) => admin.setStage(ctxOf(c), c.params.examId, c.body.stage),
      }),
      defineRoute({
        method: 'PUT',
        url: '/admin/exam-subjects/:examSubjectId/sections/:sectionId/teacher',
        access: requires('exams.manage'),
        schema: { params: SheetParams, body: SheetTeacherInputSchema },
        handler: (c) =>
          admin.setTeacher(ctxOf(c), c.params.examSubjectId, c.params.sectionId, c.body),
      }),
      // ---- Mark sheets -----------------------------------------------------------------------
      defineRoute({
        method: 'GET',
        url: '/marks',
        access: requires('marks.view'),
        schema: { query: ResultExamQuerySchema },
        handler: (c) => sheets.home(ctxOf(c), c.query.academicYearId),
      }),
      defineRoute({
        method: 'GET',
        url: '/marks/sheet',
        access: requires('marks.view'),
        schema: { query: MarkSheetKeySchema },
        handler: (c) => sheets.sheet(ctxOf(c), c.query),
      }),
      defineRoute({
        method: 'GET',
        url: '/marks/sheet/history',
        access: requires('marks.view'),
        schema: { query: MarkSheetKeySchema },
        handler: (c) => sheets.history(ctxOf(c), c.query),
      }),
      defineRoute({
        method: 'PUT',
        url: '/marks/sheet',
        access: requires('marks.view'),
        schema: { body: MarkSheetSaveSchema },
        handler: (c) => sheets.save(ctxOf(c), c.body),
      }),
      defineRoute({
        method: 'POST',
        url: '/marks/sheet/submit',
        access: requires('marks.view'),
        schema: { body: MarkSheetSubmitSchema },
        handler: (c) => sheets.submit(ctxOf(c), c.body),
      }),
      defineRoute({
        method: 'POST',
        url: '/marks/sheet/unlock',
        access: requires('marks.view'),
        schema: { body: MarkSheetUnlockSchema },
        handler: (c) => sheets.unlock(ctxOf(c), c.body),
      }),
      // ---- Results ---------------------------------------------------------------------------
      defineRoute({
        method: 'GET',
        url: '/results/me',
        access: requires('results.view'),
        schema: { query: ResultExamQuerySchema },
        handler: (c) => results.myExams(ctxOf(c), c.query.academicYearId),
      }),
      defineRoute({
        method: 'GET',
        url: '/results/me/exams/:examId',
        access: requires('results.view'),
        schema: { params: ExamParam },
        handler: (c) => results.myResult(ctxOf(c), c.params.examId),
      }),
      defineRoute({
        method: 'GET',
        url: '/results/options',
        access: requires('results.view'),
        schema: { query: ResultExamQuerySchema },
        handler: (c) => results.options(ctxOf(c), c.query.academicYearId),
      }),
      defineRoute({
        method: 'GET',
        url: '/results/exams/:examId/sections/:sectionId',
        access: requires('results.view'),
        schema: { params: z.object({ examId: IdSchema, sectionId: IdSchema }) },
        handler: (c) => results.classResult(ctxOf(c), c.params.examId, c.params.sectionId),
      }),
      defineRoute({
        method: 'GET',
        url: '/results/exams/:examId/students/:studentId',
        access: requires('results.view'),
        schema: { params: z.object({ examId: IdSchema, studentId: IdSchema }) },
        handler: (c) => results.studentResultFor(ctxOf(c), c.params.examId, c.params.studentId),
      }),
    ],
  };
}
