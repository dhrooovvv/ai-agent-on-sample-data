# JavaScript data-analysis agent V1

This is a new Node.js implementation. It does not modify or migrate the existing Python project.

## Architecture

`server.js` exposes `/health` and `/analyze`. The analyze route parses an uploaded CSV in memory, validates the request, and passes records plus the question to `agentService`. `agentService` sends only the user request and dataset metadata to JEV System One for ordered typed tool choices. `toolRegistry.js` validates the plan, resolves deterministic parameters, and dispatches only to approved JavaScript tools.

JEV answers `step_1` through `step_8` Choice questions so a plan can represent longer workflows. A later `review` choice means there are no more steps. The application normalizes those answers to `{ plan: [{ tool, parameters? }] }`. Plans may also contain validated deterministic result operations such as `select_group` and `lookup_row`. Filtered rows become the input records for the next dataset tool; grouped and scalar results cannot be silently treated as raw rows. No generated code is executed.

The tool registry is the extension point for future analysis tools. Each tool owns its declaration and execution function, so adding a tool later means adding its module and registering it in the registry without changing the agent loop.

## Current tool

`dataset_summary` dynamically reports row count, column count, column names, inferred data types, missing-value counts, unique-value counts, and numeric descriptive statistics (count, sum, minimum, maximum, mean, median, and population standard deviation). It does not assume the sample CSV schema.

`aggregate_data` performs `sum`, `average`/`mean`, `min`, `max`, and record `count`. Numeric operations validate the requested column, ignore missing or invalid numeric values, and return the number of valid values used. The calculation is always performed by JavaScript.

The other active tools are `filter_data` for validated AND/OR-combined row conditions, `group_by_analysis` for deterministic grouped aggregations, `correlation_analysis` for Pearson correlation, and `time_series_analysis` for daily or monthly date-bucket aggregations. Invalid values are handled by the tools, and no tool executes generated code.

JavaScript performs the calculations because the dataset stays in the application and deterministic code is safer and more reproducible than executing generated code. JEV selects a tool only; it never receives the full dataset and never calculates the result. Gemini is disabled in the current request flow and its previous integration is retained as commented code in `agentService.js`.

## Setup

```bash
npm install
cp .env.example .env
```

Set `TYPESAFE_API_KEY` in `.env`. `TYPESAFE_BASE_URL` defaults to `https://api.codiv.ai` and `TYPESAFE_MODEL` defaults to `openjev-latest`, the current Codiv System One model alias. The key is read only for the Authorization header and is never printed by the application. Gemini variables remain for the disabled integration.

## Run

```bash
npm run dev
# or
npm start
```

Health check:

```bash
curl http://localhost:3000/health
```

Analyze a CSV:

```bash
curl -X POST http://localhost:3000/analyze \
  -F "file=@sample_data/sample_sales.csv" \
  -F "question=How many rows and columns are in this dataset?"
```

The response has the shape `{ success, question, answer, result, tools_used }`. `result` contains deterministic values returned by the selected JavaScript tool.

## Tests

```bash
npm test
```

Tests cover dynamic summary calculations, aggregate operations and validation, JEV request/decision validation, the 15-row/9-column sample, natural-language tool selection, and the multipart API contract. Provider tests inject a fetch boundary so they do not require a live Codiv key.
