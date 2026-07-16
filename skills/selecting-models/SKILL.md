---
name: selecting-models
description: Use when choosing, comparing, or recommending LLMs, providers, model variants, pricing, usage limits, latency modes, open-weight options, or self-hosting setups.
metadata:
  version: 1.1.0
  last-reviewed: "2026-07-15"
---

# Model Selection

Choose the least expensive configuration that reliably satisfies the task.
Base recommendations on the user's providers, plan, budget, limits, and
workflow—not on a permanent favorite model.

## Selection Framework

1. **Classify the task:** chat, writing, coding, planning, research,
   extraction, multimodal work, tool use, or long-running autonomy.
2. **Define constraints:** quality, reasoning, context, output length, latency,
   throughput, tools, modalities, privacy, region, license, and hosting.
3. **Filter by availability:** use only models available through the user's
   authenticated providers, plan, region, and client.
4. **Compare cost per task:** include input, cache, output, reasoning, retries,
   tools, context growth, and subscription credits.
5. **Choose the cheapest adequate option:** escalate only when measurements
   justify it, and label uncertainty or use a representative A/B test.

## Quick Reference

| Need | Prioritize |
| --- | --- |
| Fast interaction | Latency, throughput, and cost per task |
| Complex reasoning | Quality at comparable effort levels |
| Agentic coding | Tools, edit reliability, context, and retries |
| Large context | Tested quality, cache behavior, and input cost |
| Multimodal work | Required modalities and fidelity |
| Open-weight/self-hosted | License, weights, hardware, and serving cost |

**Example:** compare Standard and Fast on the same coding task. Record time,
successful tool calls, iterations, and credits. Choose Fast only when its time
saving justifies its measured extra consumption.

## Pricing and Usage Rules

- Never transfer API token prices to a subscription plan, or subscription
  limits to API billing.
- Treat **model**, **reasoning effort**, **speed/priority mode**, and **route**
  as separate cost dimensions.
- For fast mode, verify supported models, speed change, and credit/token
  multiplier independently. Never infer the multiplier from a model name,
  list price, or another model.
- Report absolute and relative impact, such as “2× credits per task”. State
  whether limits are per request, rolling window, quota, shared pool, or usage.

## Evidence and Freshness

Prefer sources in this order:

1. Provider pricing, limits, and feature documentation.
2. Independent evaluations of quality, speed, and cost per task.
3. Aggregators for discovery and normalization.

Check current sources for pricing, availability, limits, and recent releases.
Label vendor-reported and independent results; do not present stale or
conflicting data as certain.

## Common Mistakes

- Recommending a flagship without measuring task-level benefit.
- Comparing models using different effort levels, context sizes, or providers.
- Treating context-window size as equivalent to long-context quality.
- Ignoring cached input, tool calls, retries, and agent-loop iterations.
- Assuming “open-weight” means self-hostable, commercially unrestricted, or
  operationally cheap; verify weights, license, hardware, and serving costs.

## Maintenance

- Review every 30 days or when pricing/plan semantics materially change.
- Keep guidance evidence-backed; do not add permanent model winners or default
  providers.
