import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Badge,
  Button,
  Card,
  Group,
  Modal,
  NumberInput,
  Progress,
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
  IconBuildingFactory2,
  IconPlus,
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
  StatusBadge,
  VarianceText,
} from '../components/ui';
import { date, int, money, num } from '../utils/format';

export default function ProductionPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { can } = useAuth();
  const [status, setStatus] = useState('ALL');
  const [search, setSearch] = useState('');
  const [opened, handlers] = useDisclosure(false);
  const [form, setForm] = useState({
    recipe: '',
    plannedQty: 100000,
    scheduledDate: new Date(),
    shift: 'GENERAL',
    lineNo: 'Line-1',
    remarks: '',
  });
  const [creating, setCreating] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['production'],
    queryFn: async () => (await api.get('/production')).data.data,
  });

  const { data: recipes } = useQuery({
    queryKey: ['recipes', 'approved'],
    queryFn: async () => (await api.get('/recipes', { params: { status: 'APPROVED' } })).data.data,
  });

  const approvedOptions = (recipes || []).map((r) => ({
    value: r._id,
    label: r.code + ' v' + r.version + ' — ' + r.productName,
  }));

  const selectedRecipe = (recipes || []).find((r) => r._id === form.recipe);

  const rows = useMemo(() => {
    let list = data || [];
    if (status !== 'ALL') list = list.filter((o) => o.status === status);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((o) => o.code.toLowerCase().includes(q) || o.productName.toLowerCase().includes(q));
    }
    return list;
  }, [data, status, search]);

  const stats = useMemo(() => {
    const list = data || [];
    const completed = list.filter((o) => o.status === 'COMPLETED');
    return {
      open: list.filter((o) => ['DRAFT', 'RELEASED', 'IN_PROGRESS'].includes(o.status)).length,
      planned: list.reduce((s, o) => s + o.plannedQty, 0),
      good: completed.reduce((s, o) => s + o.goodQty, 0),
      variance: completed.reduce((s, o) => s + o.totalVariance, 0),
    };
  }, [data]);

  const create = async () => {
    if (!form.recipe) return showError({ friendly: 'Choose an approved recipe' }, 'Cannot create');
    setCreating(true);
    try {
      const res = await api.post('/production', form);
      showSuccess(res.data.data.code + ' created');
      qc.invalidateQueries({ queryKey: ['production'] });
      handlers.close();
      navigate('/production/' + res.data.data._id);
    } catch (e) {
      showError(e, 'Could not create the order');
    } finally {
      setCreating(false);
    }
    return undefined;
  };

  if (isLoading) return <Loading label="Loading production orders" />;

  return (
    <PageTransition>
      <PageHeader
        icon={IconBuildingFactory2}
        title="Production"
        subtitle="Scale an approved recipe to any quantity, issue actual material, and let the system compute the variance and post the ledger."
        actions={
          <Group gap="xs">
            <ExportMenu reportKey="production-summary" label="Export summary" />
            {can('production.create') && (
              <Button leftSection={<IconPlus size={16} />} onClick={handlers.open}>
                New order
              </Button>
            )}
          </Group>
        }
      />

      <SimpleGrid cols={{ base: 2, md: 4 }} spacing="md" mb="md">
        <StatCard label="Open orders" value={stats.open} compact />
        <StatCard label="Planned units" value={int(stats.planned)} compact />
        <StatCard label="Good output" value={int(stats.good)} compact color="teal" />
        <StatCard
          label="Cost variance"
          value={money(stats.variance, 0)}
          compact
          color={stats.variance > 0 ? 'red' : 'teal'}
          sub={stats.variance > 0 ? 'Adverse' : 'Favourable'}
        />
      </SimpleGrid>

      <Card mb="md" p="sm">
        <Group justify="space-between" wrap="wrap" gap="sm">
          <SegmentedControl
            size="xs"
            value={status}
            onChange={setStatus}
            data={[
              { label: 'All', value: 'ALL' },
              { label: 'Draft', value: 'DRAFT' },
              { label: 'Released', value: 'RELEASED' },
              { label: 'In progress', value: 'IN_PROGRESS' },
              { label: 'Completed', value: 'COMPLETED' },
            ]}
          />
          <TextInput
            placeholder="Search order or product"
            leftSection={<IconSearch size={15} />}
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
            w={{ base: '100%', sm: 260 }}
          />
        </Group>
      </Card>

      {!rows.length ? (
        <EmptyState
          title="No production orders"
          description="Create an order from an approved recipe to begin."
          icon={IconBuildingFactory2}
          action={
            can('production.create') && (
              <Button onClick={handlers.open} leftSection={<IconPlus size={16} />}>
                New order
              </Button>
            )
          }
        />
      ) : (
        <Section>
          <Table.ScrollContainer minWidth={1040}>
            <Table highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Order</Table.Th>
                  <Table.Th>Product</Table.Th>
                  <Table.Th>Recipe</Table.Th>
                  <Table.Th>Status</Table.Th>
                  <Table.Th ta="right">Planned</Table.Th>
                  <Table.Th ta="right">Good</Table.Th>
                  <Table.Th>Yield</Table.Th>
                  <Table.Th ta="right">Std / unit</Table.Th>
                  <Table.Th ta="right">Act / unit</Table.Th>
                  <Table.Th ta="right">Variance</Table.Th>
                  <Table.Th>Date</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {rows.map((o) => {
                  const yieldPct = o.plannedQty ? (o.goodQty / o.plannedQty) * 100 : 0;
                  return (
                    <Table.Tr
                      key={o._id}
                      style={{ cursor: 'pointer' }}
                      onClick={() => navigate('/production/' + o._id)}
                    >
                      <Table.Td>
                        <Text size="sm" fw={700} ff="monospace">
                          {o.code}
                        </Text>
                        <Text size="10px" c="dimmed">
                          {o.lineNo} · shift {o.shift}
                        </Text>
                      </Table.Td>
                      <Table.Td>{o.productName}</Table.Td>
                      <Table.Td>
                        <Badge size="sm" variant="outline" color="gray">
                          {o.recipeCode} v{o.recipeVersion}
                        </Badge>
                      </Table.Td>
                      <Table.Td>
                        <StatusBadge status={o.status} />
                      </Table.Td>
                      <Table.Td ta="right">{int(o.plannedQty)}</Table.Td>
                      <Table.Td ta="right">{int(o.goodQty)}</Table.Td>
                      <Table.Td>
                        {o.goodQty > 0 ? (
                          <Tooltip label={num(yieldPct, 1) + '% yield'}>
                            <Progress
                              value={yieldPct}
                              size="sm"
                              radius="xl"
                              w={64}
                              color={yieldPct >= 97 ? 'teal' : yieldPct >= 92 ? 'yellow' : 'red'}
                            />
                          </Tooltip>
                        ) : (
                          <Text size="xs" c="dimmed">
                            -
                          </Text>
                        )}
                      </Table.Td>
                      <Table.Td ta="right" ff="monospace">
                        {o.standardUnitCost ? num(o.standardUnitCost, 4) : '-'}
                      </Table.Td>
                      <Table.Td ta="right" ff="monospace" fw={600}>
                        {o.actualUnitCost ? num(o.actualUnitCost, 4) : '-'}
                      </Table.Td>
                      <Table.Td ta="right">
                        {o.status === 'COMPLETED' ? <VarianceText value={o.totalVariance} /> : <Text size="xs" c="dimmed">-</Text>}
                      </Table.Td>
                      <Table.Td>
                        <Text size="xs" c="dimmed">
                          {date(o.scheduledDate)}
                        </Text>
                      </Table.Td>
                    </Table.Tr>
                  );
                })}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </Section>
      )}

      {/* ---------------------------- create modal --------------------------- */}
      <Modal opened={opened} onClose={handlers.close} title="New production order" size="lg">
        <Stack>
          <Select
            label="Approved recipe"
            description="Only approved versions can be produced"
            placeholder={approvedOptions.length ? 'Choose a recipe' : 'No approved recipe available'}
            data={approvedOptions}
            value={form.recipe}
            onChange={(v) => setForm({ ...form, recipe: v })}
            searchable
            required
          />

          <SimpleGrid cols={{ base: 1, xs: 2 }}>
            <NumberInput
              label="Planned quantity (good units)"
              description="Try 100, 1,000 or 1,000,000 — the formula scales"
              value={form.plannedQty}
              onChange={(v) => setForm({ ...form, plannedQty: v })}
              min={1}
              thousandSeparator
            />
            <DateInput
              label="Scheduled date"
              value={form.scheduledDate}
              onChange={(v) => setForm({ ...form, scheduledDate: v })}
            />
            <Select
              label="Shift"
              data={['GENERAL', 'A', 'B', 'C']}
              value={form.shift}
              onChange={(v) => setForm({ ...form, shift: v })}
            />
            <TextInput
              label="Line"
              value={form.lineNo}
              onChange={(e) => setForm({ ...form, lineNo: e.currentTarget.value })}
            />
          </SimpleGrid>

          <Textarea
            label="Remarks"
            value={form.remarks}
            onChange={(e) => setForm({ ...form, remarks: e.currentTarget.value })}
            minRows={2}
          />

          {selectedRecipe && (
            <Card withBorder p="sm" bg="var(--mantine-color-default-hover)">
              <Text size="xs" c="dimmed" fw={700} tt="uppercase" mb={6}>
                Estimated at this volume
              </Text>
              <SimpleGrid cols={2} spacing={6}>
                <Text size="xs">Material</Text>
                <Text size="xs" ta="right" ff="monospace">
                  {money(selectedRecipe.materialCostPerUnit * (form.plannedQty || 0), 0)}
                </Text>
                <Text size="xs">Labour + factory overhead</Text>
                <Text size="xs" ta="right" ff="monospace">
                  {money(
                    (selectedRecipe.labourCostPerUnit + selectedRecipe.factoryOverheadPerUnit) *
                      (form.plannedQty || 0),
                    0
                  )}
                </Text>
                <Text size="sm" fw={700}>
                  Manufacturing cost
                </Text>
                <Text size="sm" ta="right" fw={800} ff="monospace">
                  {money(selectedRecipe.manufacturingCostPerUnit * (form.plannedQty || 0), 0)}
                </Text>
                <Text size="xs" c="dimmed">
                  Per unit
                </Text>
                <Text size="xs" ta="right" c="dimmed" ff="monospace">
                  {money(selectedRecipe.manufacturingCostPerUnit, 4)}
                </Text>
              </SimpleGrid>
            </Card>
          )}

          <Group justify="flex-end">
            <Button variant="default" onClick={handlers.close}>
              Cancel
            </Button>
            <Button onClick={create} loading={creating}>
              Create order
            </Button>
          </Group>
        </Stack>
      </Modal>
    </PageTransition>
  );
}
