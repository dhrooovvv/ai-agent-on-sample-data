import { parse } from 'csv-parse/sync';
import { AppError } from '../utils/errors.js';
import { validateDataset } from './validationService.js';

export function parseCsvBuffer(buffer) {
  if (!buffer?.length) throw new AppError('CSV file is required', 400);
  try {
    const records = parse(buffer, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      bom: true,
      relax_column_count: false,
    });
    return validateDataset(records);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(`Invalid CSV: ${error.message}`, 400);
  }
}
