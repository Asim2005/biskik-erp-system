import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ActionIcon,
  Badge,
  Button,
  Card,
  Group,
  Modal,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Textarea,
  TextInput,
  Tooltip,
} from '@mantine/core';
import { DateInput } from '@mantine/dates';
import { useDisclosure } from '@mantine/hooks';
import {
  IconEye,
  IconFileInvoice,
  IconPlus,
  IconSearch,
  IconSend,
} from '@tabler/icons-react';
import { api, showError, showSuccess } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { ExcelGrid } from '../components/ExcelGrid';
import {
  EmptyState,
  ExportMenu,
  Loading,
  PageHeader,
  PageTransition,
  Section,
  StatCard,
  StatusBadge,
} from '../components/ui';
import { date, money, num } from '../utils/format';

const blankLine = () => ({
  __key: Math.random().toString(36).slice(2),
  material: '',
  qty: 0,
  rate: 0,
  discountPercent: 0,
  taxRate: 18,
});

export default function InvoicesPage() {
  const qc = useQueryClient();
  const { can } = useAuth();
  const [kind, setKind] = useState('SALES');
  const [search, setSearch] = useState('');
  const [opened, handlers] = useDisclosure(false);
  const [viewOpen, viewHandlers] = useDisclosure(false);
  const [viewing, setViewing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ party: '', date: new Date(), reference: '', remarks: '' });
  const [lines, setLines] = useState([blankLine()]);

  const { data, isLoading } = useQuery({
    queryKey: ['invoices', kind],
    queryFn: async () => (await api.get('/invoices', { params: { kind } })).data,
  });

  const { data: parties } = useQuery({
    queryKey: ['parties'],
    queryFn: async () => (await api.get('/parties')).data.data,
  });

  const { data: materials } = useQuery({
    queryKey: ['materials'],
    queryFn: async () => (await api.get('/materials')).data.data,
  });

  const materialById = useMemo(() => new Map((materials || []).map((m) => [m._id, m])), [materials]);

  const materialOptions = useMemo(
    () =>
      (materials || [])
        .filter((m) => (kind === 'SALES' ? m.category === 'FINISHED' : m.category !== 'FINISHED'))
        .map((m) => ({ value: m._id, label: m.code + ' - ' + m.name })),
    [materials, kind]
  );

  const partyOptions = useMemo(
    () =>
      (parties || [])
        .filter((p) => p.type === (kind === 'SALES' ? 'CUSTOMER' : 'SUPPLIER'))
        .map((p) => ({ value: p._id, label: p.name })),
    [parties, kind]
  );

  const columns = useMemo(
    () => [
      {
        key: 'material',
        title: 'Item',
        width: 240,
        type: 'select',
        options: materialOptions,
        required: true,
        onCellChange: (row, value) => {
          const m = materialById.get(value);
          return m
            ? { ...row, taxRate: m.taxRate, rate: row.rate || (kind === 'PURCHASE' ? m.standardRate : 0) }
            : row;
        },
      },
      { key: 'qty', title: 'Quantity', width: 110, type: 'number', align: 'right', precision: 3, min: 0, total: true },
      { key: 'rate', title: 'Rate', width: 100, type: 'number', align: 'right', precision: 2, min: 0 },
      { key: 'discountPercent', title: 'Disc %', width: 80, type: 'number', align: 'right', min: 0, max: 100 },
      {
        key: '__amount',
        title: 'Amount',
        width: 120,
        type: 'computed',
        align: 'right',
        total: true,
        compute: (r) => (Number(r.qty) || 0) * (Number(r.rate) || 0) * (1 - (Number(r.discountPercent) || 0) / 100),
        format: (v) => num(v, 2),
      },
      { key: 'taxRate', title: 'Tax %', width: 80, type: 'number', align: 'right', min: 0, max: 100 },
      {
        key: '__tax',
        title: 'Tax amount',
        width: 120,
        type: 'computed',
        align: 'right',
        total: true,
        compute: (r) => {
          const amount = (Number(r.qty) || 0) * (Number(r.rate) || 0) * (1 - (Number(r.discountPercent) || 0) / 100);
          return (amount * (Number(r.taxRate) || 0)) / 100;
        },
        format: (v) => num(v, 2),
      },
      {
        key: '__total',
        title: 'Line total',
        width: 130,
        type: 'computed',
        align: 'right',
        total: true,
        compute: (r) => {
          const amount = (Number(r.qty) || 0) * (Number(r.rate) || 0) * (1 - (Number(r.discountPercent) || 0) / 100);
          return amount + (amount * (Number(r.taxRate) || 0)) / 100;
        },
        format: (v) => num(v, 2),
      },
    ],
    [materialOptions, materialById, kind]
  );

  const totals = useMemo(() => {
    let subtotal = 0;
    let tax = 0;
    lines.forEach((l) => {
      const amount = (Number(l.qty) || 0) * (Number(l.rate) || 0) * (1 - (Number(l.discountPercent) || 0) / 100);
      subtotal += amount;
      tax += (amount * (Number(l.taxRate) || 0)) / 100;
    });
    return { subtotal, tax, grand: subtotal + tax };
  }, [lines]);

  const rows = useMemo(() => {
    let list = data?.data || [];
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((i) => i.code.toLowerCase().includes(q) || (i.partyName || '').toLowerCase().includes(q));
    }
    return list;
  }, [data, search]);

  const create = async ({ andPost = false } = {}) => {
    setBusy(true);
    try {
      const payload = {
        kind,
        party: form.party,
        date: form.date,
        reference: form.reference,
        remarks: form.remarks,
        lines: lines
          .filter((l) => l.material && Number(l.qty) > 0)
          .map((l) => ({
            material: l.material,
            qty: Number(l.qty),
            rate: Number(l.rate) || 0,
            discountPercent: Number(l.discountPercent) || 0,
            taxRate: Number(l.taxRate) || 0,
          })),
      };
      if (!payload.party) throw { friendly: 'Select a ' + (kind === 'SALES' ? 'customer' : 'supplier') };
      if (!payload.lines.length) throw { friendly: 'Add at least one line with a quantity' };

      const res = await api.post('/invoices', payload);
      showSuccess(res.data.data.code + ' created');

      if (andPost) {
        await api.post('/invoices/' + res.data.data._id + '/post');
        showSuccess('Posted to the ledger and stock relieved', res.data.data.code);
      }

      qc.invalidateQueries({ queryKey: ['invoices'] });
      qc.invalidateQueries({ queryKey: ['inventory'] });
      qc.invalidateQueries({ queryKey: ['tax'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      handlers.close();
      setLines([blankLine()]);
      setForm({ party: '', date: new Date(), reference: '', remarks: '' });
    } catch (e) {
      showError(e, 'Could not create the invoice');
    } finally {
      setBusy(false);
    }
  };

  const post = async (invoice) => {
    try {
      await api.post('/invoices/' + invoice._id + '/post');
      showSuccess(invoice.code + ' posted');
      qc.invalidateQueries({ queryKey: ['invoices'] });
      qc.invalidateQueries({ queryKey: ['inventory'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    } catch (e) {
      showError(e, 'Could not post ' + invoice.code);
    }
  };

  const openView = async (invoice) => {
    try {
      const res = await api.get('/invoices/' + invoice._id);
      setViewing(res.data.data);
      viewHandlers.open();
    } catch (e) {
      showError(e);
    }
  };

  if (isLoading) return <Loading label="Loading invoices" />;

  const isSales = kind === 'SALES';

  return (
    <PageTransition>
      <PageHeader
        icon={IconFileInvoice}
        title="Sales and purchases"
        subtitle="Posting a sales invoice relieves finished goods at moving average and records the real cost of goods sold. Posting a purchase receives stock and books recoverable input tax."
        actions={
          <Group gap="xs">
            <ExportMenu reportKey={isSales ? 'sales-register' : 'purchase-register'} label="Register" />
            {can(isSales ? 'sales.manage' : 'purchase.manage') && (
              <Button leftSection={<IconPlus size={16} />} onClick={handlers.open}>
                New {isSales ? 'sales' : 'purchase'} invoice
              </Button>
            )}
          </Group>
        }
      />

      <SimpleGrid cols={{ base: 2, md: 4 }} spacing="md" mb="md">
        <StatCard label="Invoices" value={data?.summary?.count || 0} compact />
        <StatCard label="Total value" value={money(data?.summary?.total || 0, 0)} compact color="teal" />
        <StatCard
          label={isSales ? 'Output tax' : 'Input tax'}
          value={money(data?.summary?.tax || 0, 0)}
          compact
          color={isSales ? 'orange' : 'blue'}
        />
        <StatCard
          label="Draft (unposted)"
          value={rows.filter((r) => r.status === 'DRAFT').length}
          compact
          color="gray"
        />
      </SimpleGrid>

      <Card mb="md" p="sm">
        <Group justify="space-between" wrap="wrap" gap="sm">
          <SegmentedControl
            value={kind}
            onChange={setKind}
            data={[
              { label: 'Sales', value: 'SALES' },
              { label: 'Purchases', value: 'PURCHASE' },
            ]}
          />
          <TextInput
            placeholder="Search invoice or party"
            leftSection={<IconSearch size={15} />}
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
            w={{ base: '100%', sm: 260 }}
          />
        </Group>
      </Card>

      {!rows.length ? (
        <EmptyState title={'No ' + kind.toLowerCase() + ' invoices'} icon={IconFileInvoice} />
      ) : (
        <Section>
          <Table.ScrollContainer minWidth={940}>
            <Table highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Invoice</Table.Th>
                  <Table.Th>Date</Table.Th>
                  <Table.Th>{isSales ? 'Customer' : 'Supplier'}</Table.Th>
                  <Table.Th>Reference</Table.Th>
                  <Table.Th>Status</Table.Th>
                  <Table.Th ta="right">Net</Table.Th>
                  <Table.Th ta="right">Tax</Table.Th>
                  <Table.Th ta="right">Total</Table.Th>
                  {isSales && <Table.Th ta="right">Gross profit</Table.Th>}
                  <Table.Th />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {rows.map((i) => (
                  <Table.Tr key={i._id}>
                    <Table.Td ff="monospace" fw={700}>
                      {i.code}
                    </Table.Td>
                    <Table.Td>{date(i.date)}</Table.Td>
                    <Table.Td>{i.partyName}</Table.Td>
                    <Table.Td>
                      <Text size="xs" c="dimmed">
                        {i.reference || '-'}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <StatusBadge status={i.status} />
                    </Table.Td>
                    <Table.Td ta="right" ff="monospace">
                      {num(i.subtotal, 2)}
                    </Table.Td>
                    <Table.Td ta="right" ff="monospace">
                      {num(i.taxTotal, 2)}
                    </Table.Td>
                    <Table.Td ta="right" ff="monospace" fw={700}>
                      {num(i.grandTotal, 2)}
                    </Table.Td>
                    {isSales && (
                      <Table.Td ta="right" ff="monospace" c={i.grossProfit > 0 ? 'teal.7' : 'dimmed'}>
                        {i.status === 'POSTED' ? num(i.grossProfit, 2) : '-'}
                      </Table.Td>
                    )}
                    <Table.Td>
                      <Group gap={2} justify="flex-end" wrap="nowrap">
                        <Tooltip label="View">
                          <ActionIcon variant="subtle" onClick={() => openView(i)}>
                            <IconEye size={16} />
                          </ActionIcon>
                        </Tooltip>
                        {i.status === 'DRAFT' && can(isSales ? 'sales.manage' : 'purchase.manage') && (
                          <Tooltip label="Post to ledger">
                            <ActionIcon variant="light" color="teal" onClick={() => post(i)}>
                              <IconSend size={16} />
                            </ActionIcon>
                          </Tooltip>
                        )}
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </Section>
      )}

      {/* ---------------------------- create modal --------------------------- */}
      <Modal
        opened={opened}
        onClose={handlers.close}
        title={'New ' + (isSales ? 'sales' : 'purchase') + ' invoice'}
        size="85%"
      >
        <Stack>
          <SimpleGrid cols={{ base: 1, xs: 3 }}>
            <Select
              label={isSales ? 'Customer' : 'Supplier'}
              data={partyOptions}
              value={form.party}
              onChange={(v) => setForm({ ...form, party: v })}
              searchable
              required
            />
            <DateInput label="Date" value={form.date} onChange={(v) => setForm({ ...form, date: v })} />
            <TextInput
              label="Reference"
              placeholder="Delivery order / supplier invoice no."
              value={form.reference}
              onChange={(e) => setForm({ ...form, reference: e.currentTarget.value })}
            />
          </SimpleGrid>

          <ExcelGrid columns={columns} rows={lines} onChange={setLines} emptyRow={blankLine} minRows={1} />

          <Textarea
            label="Remarks"
            value={form.remarks}
            onChange={(e) => setForm({ ...form, remarks: e.currentTarget.value })}
            minRows={2}
          />

          <Group justify="space-between">
            <Group gap="lg">
              <Text size="sm">
                Net <b>{money(totals.subtotal, 2)}</b>
              </Text>
              <Text size="sm">
                Tax <b>{money(totals.tax, 2)}</b>
              </Text>
              <Badge size="lg" variant="light">
                Total {money(totals.grand, 2)}
              </Badge>
            </Group>
            <Group>
              <Button variant="default" onClick={handlers.close}>
                Cancel
              </Button>
              <Button variant="light" loading={busy} onClick={() => create()}>
                Save draft
              </Button>
              <Button loading={busy} onClick={() => create({ andPost: true })}>
                Save and post
              </Button>
            </Group>
          </Group>
        </Stack>
      </Modal>

      {/* ----------------------------- view modal ---------------------------- */}
      <Modal opened={viewOpen} onClose={viewHandlers.close} title={viewing?.code} size="lg">
        {viewing && (
          <Stack>
            <Group justify="space-between">
              <div>
                <Text fw={700}>{viewing.party?.name || viewing.partyName}</Text>
                <Text size="xs" c="dimmed">
                  {viewing.party?.address} {viewing.party?.city}
                </Text>
                {viewing.party?.ntn && (
                  <Text size="xs" c="dimmed">
                    NTN {viewing.party.ntn} · STRN {viewing.party.strn || '-'}
                  </Text>
                )}
              </div>
              <div style={{ textAlign: 'right' }}>
                <StatusBadge status={viewing.status} />
                <Text size="xs" c="dimmed" mt={4}>
                  {date(viewing.date)}
                </Text>
              </div>
            </Group>

            <Table fz="xs">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Item</Table.Th>
                  <Table.Th ta="right">Qty</Table.Th>
                  <Table.Th ta="right">Rate</Table.Th>
                  <Table.Th ta="right">Amount</Table.Th>
                  <Table.Th ta="right">Tax</Table.Th>
                  <Table.Th ta="right">Total</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {viewing.lines.map((l, i) => (
                  <Table.Tr key={i}>
                    <Table.Td>
                      {l.materialName}
                      <Text size="10px" c="dimmed" ff="monospace">
                        {l.materialCode}
                      </Text>
                    </Table.Td>
                    <Table.Td ta="right" ff="monospace">
                      {num(l.qty, 2)} {l.uom}
                    </Table.Td>
                    <Table.Td ta="right" ff="monospace">
                      {num(l.rate, 2)}
                    </Table.Td>
                    <Table.Td ta="right" ff="monospace">
                      {num(l.amount, 2)}
                    </Table.Td>
                    <Table.Td ta="right" ff="monospace">
                      {num(l.taxAmount, 2)}
                    </Table.Td>
                    <Table.Td ta="right" ff="monospace" fw={600}>
                      {num(l.lineTotal, 2)}
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>

            <Stack gap={4}>
              <Group justify="space-between">
                <Text size="sm">Net amount</Text>
                <Text size="sm" ff="monospace">
                  {money(viewing.subtotal, 2)}
                </Text>
              </Group>
              <Group justify="space-between">
                <Text size="sm">Sales tax</Text>
                <Text size="sm" ff="monospace">
                  {money(viewing.taxTotal, 2)}
                </Text>
              </Group>
              <Group justify="space-between">
                <Text fw={800}>Grand total</Text>
                <Text fw={800} ff="monospace">
                  {money(viewing.grandTotal, 2)}
                </Text>
              </Group>
              {viewing.kind === 'SALES' && viewing.status === 'POSTED' && (
                <>
                  <Group justify="space-between">
                    <Text size="sm" c="dimmed">
                      Cost of goods sold
                    </Text>
                    <Text size="sm" ff="monospace" c="dimmed">
                      {money(viewing.cogsAmount, 2)}
                    </Text>
                  </Group>
                  <Group justify="space-between">
                    <Text size="sm" fw={700} c="teal.7">
                      Gross profit
                    </Text>
                    <Text size="sm" fw={700} ff="monospace" c="teal.7">
                      {money(viewing.grossProfit, 2)} (
                      {num((viewing.grossProfit / viewing.subtotal) * 100, 1)}%)
                    </Text>
                  </Group>
                </>
              )}
            </Stack>

            {viewing.journalEntry && (
              <Card withBorder p="xs">
                <Text size="xs" c="dimmed">
                  Posted via journal entry{' '}
                  <Text component="span" ff="monospace" fw={700}>
                    {viewing.journalEntry.code}
                  </Text>
                </Text>
              </Card>
            )}
          </Stack>
        )}
      </Modal>
    </PageTransition>
  );
}
