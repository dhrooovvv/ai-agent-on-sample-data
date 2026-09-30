# JavaScript data-analysis agent V1

This is a Node.js implementation built in `js-agent/`. It does not modify, migrate, or depend on the existing Python project.

## Architecture

`server.js` exposes `/health` and `/analyze`. The analyze route parses an uploaded CSV in memory, validates the request, and passes records plus the question to `agentService`. `agentService` sends only the user request and dataset metadata to JEV System One for ordered typed tool choices. `toolRegistry.js` validates the plan, resolves deterministic parameters, and dispatches only to approved JavaScript tools.

JEV answers `step_1` through `step_8` Choice questions so a plan can represent longer workflows. A later `review` choice means there are no more steps. The application normalizes those answers to `{ plan: [{ tool, parameters? }] }`. Plans may also contain validated deterministic result operations such as `select_group` and `lookup_row`. Filtered rows become the input records for the next dataset tool; grouped and scalar results cannot be silently treated as raw rows. No generated code is executed.

The tool registry is the extension point for future analysis tools. Each tool owns its declaration and execution function, so adding a tool later means adding its module and registering it in the registry without changing the agent loop.

The execution pipeline is:

```text
CSV upload
  -> CSV parser
  -> dataset metadata
  -> JEV execution plan
  -> plan validation
  -> deterministic JavaScript tools
  -> typed intermediate results
  -> final structured result
  -> concise natural-language answer
```

The executor preserves the output of each step. For example, a filtered dataset is passed to an aggregate tool, while a grouped result must first pass through `select_group` before another dataset calculation can run. Incomplete plans are rejected instead of returning an intermediate result as the final answer.

## Current tool

`dataset_summary` dynamically reports row count, column count, column names, inferred data types, missing-value counts, unique-value counts, and numeric descriptive statistics (count, sum, minimum, maximum, mean, median, and population standard deviation). It does not assume the sample CSV schema.

`aggregate_data` performs `sum`, `average`/`mean`, `min`, `max`, and record `count`. Numeric operations validate the requested column, ignore missing or invalid numeric values, and return the number of valid values used. The calculation is always performed by JavaScript.

The other active tools are `filter_data` for validated AND/OR-combined row conditions, `group_by_analysis` for deterministic grouped aggregations, `correlation_analysis` for Pearson correlation, and `time_series_analysis` for daily or monthly date-bucket aggregations. Invalid values are handled by the tools, and no tool executes generated code.

JavaScript performs the calculations because the dataset stays in the application and deterministic code is safer and more reproducible than executing generated code. JEV creates the ordered tool plan; it never receives the full dataset and never calculates the result. Gemini is disabled in the current request flow and its previous integration is retained as commented code in `agentService.js`.

## Setup

```bash
npm install
cp .env.example .env
```

Set the following variable in `.env`:

```dotenv
TYPESAFE_API_KEY=your_codiv_api_key
```

Optional variables:

```dotenv
TYPESAFE_BASE_URL=https://api.codiv.ai
TYPESAFE_MODEL=openjev-latest
```

The key is read only for the Authorization header and is never printed in logs or responses. Gemini variables remain available only for the disabled integration.

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

The response has this shape:

```json
{
  "success": true,
  "question": "What is the average salary of Engineering employees over 30?",
  "answer": "The average of salary is 85000.",
  "result": {
    "operation": "average",
    "column": "salary",
    "value": 85000,
    "valid_values": 1
  },
  "tools_used": ["filter_data", "aggregate_data"],
  "execution_trace": [
    {
      "step": 1,
      "kind": "tool",
      "name": "filter_data",
      "inputType": "dataset",
      "outputType": "dataset_result",
      "inputRows": 10
    },
    {
      "step": 2,
      "kind": "tool",
      "name": "aggregate_data",
      "inputType": "dataset",
      "outputType": "scalar_result",
      "inputRows": 1
    }
  ]
}
```

`result` contains deterministic values returned by JavaScript. `tools_used` lists the analysis tools executed, while `execution_trace` records the ordered execution and result types without returning the dataset rows.

Unsupported requests, invalid plans, missing columns, unavailable tools, and provider failures return a structured error response. Regression analysis is not implemented in the current checkout and is rejected explicitly rather than producing a fabricated result.

## Tests

```bash
npm test
```

Tests cover dynamic summary calculations, aggregate operations and validation, multiple AND/OR filters, grouped selection, row lookup after aggregation, multi-step data flow, incomplete-plan rejection, JEV request/decision validation, the 15-row/9-column sample, natural-language tool selection, and the multipart API contract. Provider tests inject a fetch boundary so they do not require a live Codiv key.
