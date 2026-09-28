import { z } from 'zod';
import { AppError } from '../utils/errors.js';

const questionSchema = z.string().trim().min(1, 'question is required');

export function validateQuestion(value) {
  const result = questionSchema.safeParse(value);
  if (!result.success) throw new AppError('question is required', 400);
  return result.data;
}

export function validateDataset(records) {
  if (!Array.isArray(records) || records.length === 0) {
    throw new AppError('CSV must contain a header and at least one data row', 400);
  }
  return records;
}
