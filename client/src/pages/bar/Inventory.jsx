import { useState } from 'react';
import { GlassWater } from 'lucide-react';
import api from '../../services/api';
import { useAuth } from '../../store/auth';
import { useAction, useGet } from '../../hooks/useApi';
import { Async, Badge, Button, Card, EmptyState, Field, Input, PageHeader, Select, Table, Tabs, Textarea } from '../../components/ui';
import { Modal } from '../../components/feedback';
import { toast } from '../../store/toast';
import { fmtDateTime } from '../../utils/format';
import { SubNav, Mono, idem, useIdemKey, num } from './shared';

export default function BarInventory() {
  const can = useAuth((s) => s.can); const g = useGet('/bar/inventory'); const [tab, setTab] = useState('stock'); const [open, setOpen] = useState(null); const ops = useGet(tab === 'openings' ? '/bar/openings' : null, { limit: 100 });
  const liquor = (g.data || []).filter((i) => i.isLiquor); const others = (g.data || []).filter((i) => !i.isLiquor);
  return (
    <div><SubNav can={can} />
      <PageHeader title="Bottle & peg-wise stock" subtitle="Sealed bottles, opened bottles and mixers - one stock, straight from Inventory & Stores" />
      <Tabs items={[{ key: 'stock', label: 'Stock on hand' }, { key: 'openings', label: 'Bottle openings' }]} value={tab} onChange={setTab} />
      {tab === 'stock' && <div className="mt-4 space-y-4">
        <Card title="Liquor" pad={false}><Async state={g} isEmpty={() => !liquor.length} empty={<EmptyState icon={GlassWater} title="No liquor in the bar" text="Add liquor items (stock unit ml) and stock them in the Bar department from Inventory & Stores." />}>{() => <Table rows={liquor} rowKey="item" columns={[
          { header: 'Item', render: (r) => <span className="font-semibold">{r.name}<span className="block text-xs font-normal text-slate-500">{r.capacityConfigured ? `${num(r.capacityMl, 0)} ml bottle` : <span className="text-red-700">No bottle size set</span>}</span></span> },
          { header: 'Sealed bottles', className: 'text-right', render: (r) => <b>{r.sealedBottles ?? '-'}</b> }, { header: 'Opened (ml)', className: 'text-right', render: (r) => <b>{num(r.openedMl, 0)}</b> },
          { header: 'Pegs left (opened)', className: 'text-right', render: (r) => <span title="Whole pegs that can still be poured from opened bottles">{r.pegs30} × 30 ml · {r.pegs60} × 60 ml</span> },
          { header: 'Total (ml)', className: 'text-right', render: (r) => <span>{num(r.totalQty, 0)}{r.bookDrift > 0 && <Badge tone="red" className="ml-1">Check</Badge>}</span> },
          { header: '', render: (r) => can('bar.bottles.open') && r.capacityConfigured && <Button size="sm" variant="secondary" onClick={() => setOpen(r)}>Open bottle</Button> }]} />}</Async></Card>
        <Card title="Mixers & other bar stock" pad={false}><Table rows={others} rowKey="item" empty={<p className="p-4 text-sm text-slate-500">No mixers in the bar department.</p>} columns={[{ header: 'Item', render: (r) => <span className="font-semibold">{r.name}<span className="block text-xs font-normal text-slate-500">{r.category}</span>{r.needsSetup && <span className="block text-xs font-semibold text-amber-700">Needs setup: {r.needsSetup}</span>}</span> }, { header: 'On hand', className: 'text-right', render: (r) => `${num(r.totalQty, 0)} ${r.baseUnit}` }]} /></Card>
        <p className="text-xs text-slate-500">Opening a bottle moves liquor from sealed to opened - it does not use any stock. Pegs are poured from opened bottles; a full-bottle sale uses a sealed bottle. Receive stock, transfers and adjustments in Inventory &amp; Stores.</p></div>}
      {tab === 'openings' && <Card pad={false} className="mt-4"><Async state={ops} empty={<EmptyState title="No bottles opened yet" />}>{(rows) => <Table rows={rows} columns={[{ header: 'Record', render: (o) => <span><Mono>{o.openingNumber}</Mono><span className="block text-xs text-slate-500">{fmtDateTime(o.openedAt)}</span></span> }, { header: 'Item', render: (o) => <span className="font-semibold">{o.itemName}</span> },
        { header: 'Bottles', className: 'text-right', render: (o) => `${o.bottles} × ${num(o.capacityMl, 0)} ml = ${num(o.totalMl, 0)} ml` }, { header: 'Opened pool (ml)', className: 'text-right', render: (o) => `${num(o.openMlBefore, 0)} → ${num(o.openMlAfter, 0)}` }, { header: 'By', render: (o) => <span>{o.openedByName}{o.source === 'auto' && <Badge tone="blue" className="ml-1">auto</Badge>}</span> }, { header: 'Note', render: (o) => o.notes || '-' }]} />}</Async></Card>}
      <OpenModal item={open} onClose={() => setOpen(null)} onDone={() => { g.reload(); ops.reload(); }} />
    </div>
  );
}
function OpenModal({ item, onClose, onDone }) {
  const [n, setN] = useState(1); const [notes, setNotes] = useState(''); const [run, busy] = useAction(); const key = useIdemKey(); const [err, setErr] = useState('');
  if (!item) return null;
  const go = async () => { setErr(''); try { await run(() => api.post('/bar/openings', { item: item.item, bottles: Number(n), notes: notes || undefined }, idem(key.get()))); key.renew(); toast.success('Bottle opening recorded'); onDone(); onClose(); } catch (e) { setErr(e.message); } };
  return <Modal open onClose={onClose} size="sm" title={`Open ${item.name}`} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={go}>Record opening</Button></>}>
    <p className="mb-3 text-sm text-slate-600">{item.sealedBottles} sealed bottle(s) of {num(item.capacityMl, 0)} ml. The liquor moves to "opened"; nothing is used up.</p>
    {err && <p className="mb-3 rounded-lg bg-red-50 p-2 text-sm font-semibold text-red-700" role="alert">{err}</p>}
    <Field label="Bottles opened" required><Input type="number" min="1" max={item.sealedBottles || 1} value={n} onChange={(e) => setN(e.target.value)} autoFocus /></Field>
    <Field label="Note"><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field></Modal>;
}
