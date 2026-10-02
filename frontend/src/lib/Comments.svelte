<script lang="ts">
  import { formatDateTime } from "./format";
  import type { TimelineComment } from "./types";

  let { comments, label = "Kommentare" }: { comments: TimelineComment[]; label?: string } = $props();

  const COLLAPSE_AFTER = 3;
</script>

{#snippet list(items: TimelineComment[])}
  <ul class="comments">
    {#each items as comment (comment.createdAt + comment.author)}
      <li>
        <span class="bubble">{comment.text}</span>
        <span class="by">{comment.author} · {formatDateTime(comment.createdAt)}</span>
      </li>
    {/each}
  </ul>
{/snippet}

{#if comments.length > COLLAPSE_AFTER}
  <details>
    <summary>💬 {comments.length} {label}</summary>
    {@render list(comments)}
  </details>
{:else if comments.length > 0}
  {@render list(comments)}
{/if}

<style>
  details {
    margin-top: 6px;
  }

  summary {
    cursor: pointer;
    color: var(--muted);
    font-size: 0.875rem;
  }

  .comments {
    list-style: none;
    margin: 6px 0 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  li {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
  }

  .bubble {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 14px 14px 14px 4px;
    padding: 6px 12px;
    white-space: pre-line;
    max-width: 100%;
    overflow-wrap: anywhere;
  }

  .by {
    color: var(--muted);
    font-size: 0.75rem;
    padding-left: 4px;
  }
</style>
