import { type FormEvent, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { RuleCard, RuleSource } from '../../shared/rules.ts';
import { api } from '../api.ts';
import { ErrorNotice, Spinner } from '../components/Feedback.tsx';
import { PageHeader } from '../components/Layout.tsx';

interface RuleResult { rulesetId: string; sources: RuleSource[]; cards: RuleCard[]; guardrails: string[] }

export function RulesPage() {
  const [searchParams] = useSearchParams();
  const [query, setQuery] = useState(searchParams.get('q') || 'attack on preparation'); const [result, setResult] = useState<RuleResult | null>(null); const [error, setError] = useState<unknown>(); const [busy, setBusy] = useState(false);
  const search = async (value = query) => { setBusy(true); setError(undefined); try { setResult(await api.rules(value)); } catch (caught) { setError(caught); } finally { setBusy(false); } };
  useEffect(() => { void search(); }, []);
  function submit(event: FormEvent) { event.preventDefault(); void search(); }
  return <div className="page rules-page">
    <PageHeader eyebrow="VERSIONED KNOWLEDGE BASE" title="Rules desk"><p>Ask from official sabre rules, then bind the controlling references to your call.</p></PageHeader>
    <form className="rule-search" onSubmit={submit}><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Try: blade search misses, beat on forte, crossing feet…" /><button className="primary-button" disabled={busy}>{busy ? 'Searching…' : 'Find rules'}</button></form>
    <div className="quick-queries">{['attack on preparation', 'beat on forte', 'parry riposte', 'no-touch halt', 'crossing feet'].map((value) => <button key={value} onClick={() => { setQuery(value); void search(value); }}>{value}</button>)}</div>
    {Boolean(error) && <ErrorNotice error={error} />}{!result && !error && <Spinner label="Opening official rules" />}
    {result && <div className="rules-layout"><section>
      <div className="ruleset-strip"><span>ACTIVE RULESET</span><strong>{result.rulesetId}</strong><i>{result.cards.length} relevant passages</i></div>
      <div className="rule-cards">{result.cards.map((card) => <article key={card.id}>
        <header><div>{card.refs.map((ref) => <span key={ref}>{ref}</span>)}</div><small>{result.sources.find((source) => source.id === card.sourceId)?.authority || 'Official'}</small></header>
        <h2>{card.title}</h2><p>{card.summary}</p><footer><strong>Evidence to label</strong><div>{card.evidence.map((item) => <span key={item}>{item}</span>)}</div></footer>
      </article>)}</div>
    </section><aside className="source-panel"><p className="eyebrow">SOURCES IN THIS ANSWER</p>{result.sources.map((source) => <a href={source.url} target="_blank" rel="noreferrer" key={source.id}><strong>{source.authority}</strong><span>{source.title}</span><small>{source.edition} ↗</small></a>)}
      <p className="eyebrow guardrail-title">MODEL GUARDRAILS</p><ol>{result.guardrails.map((guardrail) => <li key={guardrail}>{guardrail}</li>)}</ol>
    </aside></div>}
  </div>;
}
