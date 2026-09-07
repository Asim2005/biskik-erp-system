import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Badge,
  Button,
  Card,
  Group,
  Modal,
  NumberInput,
  Progress,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Tabs,
  Text,
  Textarea,
  TextInput,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import {
  IconAdjustments,
  IconAlertTriangle,
  IconArrowsExchange,
  IconPackageImport,
  IconPackages,
  IconSearch,
} from '@tabler/icons-react';
import { api, showError, showSuccess } from '../api/client';
import { useAuth } from '../context/AuthContext';
import {
  EmptyState,
  ExportMenu,
  Loading,
  PageHeader,
  PageTransition,
  Section,
  StatCard,
} from '../components/ui';
import { dateTime, money, num } from '../utils/format';

const MOVEMENT_COLORS = {
  PURCHASE_RECEIPT: 'teal',
  PRODUCTION_RECEIPT: 'teal',
  ADJUSTMENT_IN: 'blue',
  OPENING: 'gray',
  PRODUCTION_ISSUE: 'orange',
  SALE_ISSUE: 'grape',
  ADJUSTMENT_OUT: 'red',
  SCRAP: 'red',
};

export default function InventoryPage() {
  const qc = useQueryClient();
  const { can } = useAuth();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [adjustOpen, adjustHandlers] = useDisclosure(false);
  const [receiveOpen, receiveHandlers] = useDisclosure(false);
  const [adjust, setAdjust] = useState({ material: '', direction: 'IN', qty: 0, reason: '' });
  const [receive, setReceive] = useState({ material: '', qty: 0, rate: 0, reference: '' });

  const { data: valuation, isLoading } = useQuery({
    queryKey: ['inventory', 'valuation'],
    queryFn: async () => (await api.get('/inventory/valuation')).data,
  });

  const { data: movements } = useQuery({
    queryKey: ['inventory', 'movements'],
    queryFn: async () => (await api.get('/inventory/movements', { params: { limit: 300 } })).data.data,
  });

  const { data: materials } = useQuery({
    queryKey: ['materials'],
    queryFn: async () => (await api.get('/materials')).data.data,
  });

  const materialOptions = (materials || []).map((m) => ({
    value: m._id,
    label: m.code + ' - ' + m.name + ' (' + num(m.onHand, 2) + ' ' + m.uom + ')',
  }));

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['inventory'] });
    qc.invalidateQueries({ queryKey: ['materials'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
  };

  const doAdjust = useMutation({
    mutationFn: (payload) => api.post('/inventory/adjust', payload),
    onSuccess: () => {
      showSuccess('Stock adjusted and posted to the ledger');
      invalidate();
      adjustHandlers.close();
      setAdjust({ material: '', direction: 'IN', qty: 0, reason: '' });
    },
    onError: (e) => showError(e),
  });

  const doReceive = useMutation({
    mutationFn: (payload) => api.post('/inventory/receive', payload),
    onSuccess: () => {
      showSuccess('Goods received');
      invalidate();
      receiveHandlers.close();
      setReceive({ material: '', qty: 0, rate: 0, reference: '' });
    },
    onError: (e) => showError(e),
  });

  const rows = useMemo(() => {
    let list = valuation?.data || [];
    if (category) list = list.filter((r) => r.category === category);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((r) => r.name.toLowerCase().includes(q) || r.code.toLowerCase().includes(q));
    }
    return list;
  }, [valuation, search, category]);

  if (isLoading) return <Loading label="Valuing inventory" />;

  const summary = valuation?.summary || {};
  const byCategory = summary.byCategory || {};

  return (
    <PageTransition>
      <PageHeader
        icon={IconPackages}
        title="Inventory"
        subtitle="Raw material, packaging and finished goods, valued at moving average. Every movement below has a matching journal entry, so this total equals the inventory balance in the general ledger."
        actions={
          <Group gap="xs">
            <ExportMenu reportKey="inventory-valuation" label="Valuation" />
            <ExportMenu reportKey="stock-movement" label="Movements" />
            {can('inventory.receive') && (
              <Button variant="light" leftSection={<IconPackageImport size={16} />} onClick={receiveHandlers.open}>
                Receive
              </Button>
            )}
            {can('inventory.adjust') && (
              <Button variant="default" leftSection={<IconAdjustments size={16} />} onClick={adjustHandlers.open}>
                Adjust
              </Button>
            )}
          </Group>
        }
      />

      <SimpleGrid cols={{ base: 2, md: 4 }} spacing="md" mb="md">
        <StatCard label="Total value" value={money(summary.totalValue, 0)} compact color="teal" />
        <StatCard label="Stock lines" value={summary.lineCount} compact />
        <StatCard
          label="Below reorder"
          value={summary.belowReorder}
          compact
          color={summary.belowReorder ? 'red' : 'gray'}
        />
        <StatCard label="Finished goods" value={money(byCategory.FINISHED || 0, 0)} compact color="biscuit" />
      </SimpleGrid>

      {summary.belowReorder > 0 && (
        <Alert color="orange" variant="light" icon={<IconAlertTriangle size={18} />} mb="md">
          {summary.belowReorder} item{summary.belowReorder === 1 ? ' is' : 's are'} at or below the reorder level.
          Raise a purchase before the next production run.
        </Alert>
      )}

      <Tabs defaultValue="stock" keepMounted={false}>
        <Tabs.List mb="md">
          <Tabs.Tab value="stock" leftSection={<IconPackages size={16} />}>
            Stock on hand
          </Tabs.Tab>
          <Tabs.Tab value="movements" leftSection={<IconArrowsExchange size={16} />}>
            Movement register
          </Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="stock">
          <Card mb="md" p="sm">
            <Group wrap="wrap" gap="sm">
              <TextInput
                placeholder="Search item"
                leftSection={<IconSearch size={15} />}
                value={search}
                onChange={(e) => setSearch(e.currentTarget.value)}
                style={{ flex: 1, minWidth: 200 }}
              />
              <Select
                placeholder="All categories"
                data={Object.keys(byCategory)}
                value={category}
                onChange={setCategory}
                clearable
                w={180}
              />
            </Group>
          </Card>

          {!rows.length ? (
            <EmptyState title="No stock lines match" icon={IconPackages} />
          ) : (
            <Section>
              <Table.ScrollContainer minWidth={900}>
                <Table highlightOnHover>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Code</Table.Th>
                      <Table.Th>Item</Table.Th>
                      <Table.Th>Category</Table.Th>
                      <Table.Th>Location</Table.Th>
                      <Table.Th ta="right">Quantity</Table.Th>
                      <Table.Th ta="right">Avg rate</Table.Th>
                      <Table.Th ta="right">Value</Table.Th>
                      <Table.Th>Reorder cover</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {rows.map((r) => {
                      const cover = r.reorderLevel ? Math.min(200, (r.qty / r.reorderLevel) * 100) : null;
                      return (
                        <Table.Tr key={r.materialId + r.location}>
                          <Table.Td ff="monospace" fw={600}>
                            {r.code}
                          </Table.Td>
                          <Table.Td>{r.name}</Table.Td>
                          <Table.Td>
                            <Badge size="sm" variant="light" color={r.category === 'FINISHED' ? 'teal' : 'gray'}>
                              {r.category}
                            </Badge>
                          </Table.Td>
                          <Table.Td>
                            <Text size="xs" c="dimmed">
                              {r.location}
                            </Text>
                          </Table.Td>
                          <Table.Td ta="right" ff="monospace" fw={600} c={r.belowReorder ? 'red.6' : undefined}>
                            {num(r.qty, 3)} {r.uom}
                          </Table.Td>
                          <Table.Td ta="right" ff="monospace">
                            {num(r.avgRate, 4)}
                          </Table.Td>
                          <Table.Td ta="right" ff="monospace" fw={600}>
                            {num(r.value, 2)}
                          </Table.Td>
                          <Table.Td>
                            {cover != null ? (
                              <Progress
                                value={cover / 2}
                                size="sm"
                                radius="xl"
                                w={80}
                                color={cover < 100 ? 'red' : cover < 150 ? 'orange' : 'teal'}
                              />
                            ) : (
                              <Text size="xs" c="dimmed">
                                n/a
                              </Text>
                            )}
                          </Table.Td>
                        </Table.Tr>
                      );
                    })}
                    <Table.Tr style={{ fontWeight: 700 }}>
                      <Table.Td colSpan={6}>TOTAL</Table.Td>
                      <Table.Td ta="right" ff="monospace">
                        {num(rows.reduce((s, r) => s + r.value, 0), 2)}
                      </Table.Td>
                      <Table.Td />
                    </Table.Tr>
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            </Section>
          )}
        </Tabs.Panel>

        <Tabs.Panel value="movements">
          <Section title="Stock movement register" description="Newest first, with the running balance after each posting.">
            <Table.ScrollContainer minWidth={980}>
              <Table highlightOnHover fz="xs">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Date</Table.Th>
                    <Table.Th>Item</Table.Th>
                    <Table.Th>Type</Table.Th>
                    <Table.Th>Reference</Table.Th>
                    <Table.Th ta="right">In</Table.Th>
                    <Table.Th ta="right">Out</Table.Th>
                    <Table.Th ta="right">Rate</Table.Th>
                    <Table.Th ta="right">Value</Table.Th>
                    <Table.Th ta="right">Balance qty</Table.Th>
                    <Table.Th ta="right">Balance value</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {(movements || []).map((m) => (
                    <Table.Tr key={m._id}>
                      <Table.Td>
                        <Text size="10px" c="dimmed">
                          {dateTime(m.date)}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <Text size="xs">{m.material?.name}</Text>
                        <Text size="10px" c="dimmed" ff="monospace">
                          {m.material?.code}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <Badge size="xs" variant="light" color={MOVEMENT_COLORS[m.type] || 'gray'}>
                          {m.type.replace(/_/g, ' ').toLowerCase()}
                        </Badge>
                      </Table.Td>
                      <Table.Td>
                        <Text size="10px" ff="monospace">
                          {m.refCode || m.refType || '-'}
                        </Text>
                      </Table.Td>
                      <Table.Td ta="right" ff="monospace" c="teal.7">
                        {m.qty > 0 ? num(m.qty, 3) : ''}
                      </Table.Td>
                      <Table.Td ta="right" ff="monospace" c="orange.7">
                        {m.qty < 0 ? num(-m.qty, 3) : ''}
                      </Table.Td>
                      <Table.Td ta="right" ff="monospace">
                        {num(m.rate, 2)}
                      </Table.Td>
                      <Table.Td ta="right" ff="monospace">
                        {num(Math.abs(m.value), 2)}
                      </Table.Td>
                      <Table.Td ta="right" ff="monospace">
                        {num(m.balanceQty, 3)}
                      </Table.Td>
                      <Table.Td ta="right" ff="monospace">
                        {num(m.balanceValue, 2)}
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          </Section>
        </Tabs.Panel>
      </Tabs>

      {/* ---------------------------- adjust modal --------------------------- */}
      <Modal opened={adjustOpen} onClose={adjustHandlers.close} title="Stock adjustment">
        <Stack>
          <Alert color="blue" variant="light" py="xs">
            <Text size="xs">
              An adjustment always writes a matching journal entry, so the ledger never drifts from the stock
              record.
            </Text>
          </Alert>
          <Select
            label="Material"
            data={materialOptions}
            value={adjust.material}
            onChange={(v) => setAdjust({ ...adjust, material: v })}
            searchable
            required
          />
          <Select
            label="Direction"
            data={[
              { value: 'IN', label: 'Increase (found / returned)' },
              { value: 'OUT', label: 'Decrease (damaged / expired)' },
            ]}
            value={adjust.direction}
            onChange={(v) => setAdjust({ ...adjust, direction: v })}
          />
          <NumberInput
            label="Quantity"
            value={adjust.qty}
            onChange={(v) => setAdjust({ ...adjust, qty: v })}
            min={0}
            decimalScale={3}
          />
          <Textarea
            label="Reason"
            required
            placeholder="Damaged during handling in RM store"
            value={adjust.reason}
            onChange={(e) => setAdjust({ ...adjust, reason: e.currentTarget.value })}
            minRows={2}
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={adjustHandlers.close}>
              Cancel
            </Button>
            <Button
              loading={doAdjust.isPending}
              onClick={() => doAdjust.mutate(adjust)}
              disabled={!adjust.material || !adjust.qty || adjust.reason.trim().length < 3}
            >
              Post adjustment
            </Button>
          </Group>
        </Stack>
      </Modal>

      {/* ---------------------------- receive modal -------------------------- */}
      <Modal opened={receiveOpen} onClose={receiveHandlers.close} title="Goods receipt">
        <Stack>
          <Select
            label="Material"
            data={materialOptions}
            value={receive.material}
            onChange={(v) => setReceive({ ...receive, material: v })}
            searchable
            required
          />
          <NumberInput
            label="Quantity"
            value={receive.qty}
            onChange={(v) => setReceive({ ...receive, qty: v })}
            min={0}
            decimalScale={3}
          />
          <NumberInput
            label="Rate"
            description="Re-averages the moving average cost"
            value={receive.rate}
            onChange={(v) => setReceive({ ...receive, rate: v })}
            min={0}
            decimalScale={4}
            prefix="Rs. "
          />
          <TextInput
            label="Reference"
            placeholder="Supplier delivery note"
            value={receive.reference}
            onChange={(e) => setReceive({ ...receive, reference: e.currentTarget.value })}
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={receiveHandlers.close}>
              Cancel
            </Button>
            <Button
              loading={doReceive.isPending}
              onClick={() => doReceive.mutate(receive)}
              disabled={!receive.material || !receive.qty}
            >
              Post receipt
            </Button>
          </Group>
        </Stack>
      </Modal>
    </PageTransition>
  );
}
