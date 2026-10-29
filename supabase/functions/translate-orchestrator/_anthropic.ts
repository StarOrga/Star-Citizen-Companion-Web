// Message Batches adapter over the Anthropic TypeScript SDK. Deno only (npm: specifier);
// the state machine sees just the `Llm` interface, tests never import this file.

import Anthropic from 'npm:@anthropic-ai/sdk';
import type { BatchResult, Llm } from './_machine.ts';

export function makeLlm(apiKey: string): Llm {
  // deno-lint-ignore no-explicit-any
  const client: any = new Anthropic({ apiKey });
  return {
    async createBatch(requests) {
      const b = await client.messages.batches.create({ requests });
      return { id: b.id as string };
    },
    async isEnded(id) {
      const b = await client.messages.batches.retrieve(id);
      return b.processing_status === 'ended';
    },
    async *results(id): AsyncGenerator<BatchResult> {
      // Results arrive in any order: the caller keys on custom_id.
      for await (const row of await client.messages.batches.results(id)) {
        const r = row.result;
        if (r.type !== 'succeeded') {
          yield { custom_id: row.custom_id, type: r.type };
          continue;
        }
        const text = (r.message.content ?? [])
          .filter((c: { type: string }) => c.type === 'text')
          .map((c: { text: string }) => c.text)
          .join('');
        yield {
          custom_id: row.custom_id,
          type: 'succeeded',
          text,
          stop_reason: r.message.stop_reason,
          usage: r.message.usage,
          model: r.message.model,
        };
      }
    },
    async cancel(id) {
      await client.messages.batches.cancel(id);
    },
  };
}
