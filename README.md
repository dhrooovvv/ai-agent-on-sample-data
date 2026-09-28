# JavaScript data-analysis agent V1

This is a new Node.js implementation. It does not modify or migrate the existing Python project.

## Architecture

`server.js` exposes `/health` and `/analyze`. The analyze route parses an uploaded CSV in memory, validates the request, and passes records plus the question to `agentService`. The agent service uses Gemini function calling; `toolRegistry.js` exposes only approved tools and executes their JavaScript implementations. The tool result is then returned to Gemini for the final natural-language answer.

The tool registry is the extension point for future analysis tools. Each tool owns its declaration and execution function, so adding a tool later means adding its module and registering it in the registry without changing the agent loop.

## Current tool

`dataset_summary` dynamically reports row count, column count, column names, inferred data types, missing-value counts, unique-value counts, and numeric descriptive statistics (count, sum, minimum, maximum, mean, median, and population standard deviation). It does not assume the sample CSV schema.

`aggregate_data` performs `sum`, `average`/`mean`, `min`, `max`, and record `count`. Numeric operations validate the requested column, ignore missing or invalid numeric values, and return the number of valid values used. The calculation is always performed by JavaScript.

The other active tools are `filter_data` for validated AND-combined row conditions, `group_by_analysis` for deterministic grouped aggregations, `correlation_analysis` for Pearson correlation, and `time_series_analysis` for daily or monthly date-bucket aggregations. Invalid values are handled by the tools, and no tool executes generated code.

JavaScript performs the calculations because the dataset stays in the application and deterministic code is safer and more reproducible than executing generated code. Gemini selects the approved function and explains its returned result; it never executes arbitrary code.

## Setup

```bash
npm install
cp .env.example .env
```

Set `GEMINI_API_KEY` in `.env`. `GEMINI_MODEL` defaults to `gemini-3.7-flash`. The API key is read only by the SDK and is never printed by the application.

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

Tests cover dynamic summary calculations, aggregate operations and validation, the 15-row/9-column sample, natural-language aggregate tool selection, and the multipart API contract. The API tests inject a small fake Gemini boundary so they do not require a live Gemini key; Gemini integration is isolated in `agentService.js`.
