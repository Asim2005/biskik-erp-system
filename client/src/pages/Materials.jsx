import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ActionIcon,
  Badge,
  Button,
  Card,
  Group,
  Modal,
  NumberInput,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Table,
  Text,
  Textarea,
  TextInput,
  Tooltip,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconCookie, IconEdit, IconPlus, IconSearch, IconTrash } from '@tabler/icons-react';
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
import { money, num } from '../utils/format';

const CATEGORIES = ['RAW', 'PACKAGING', 'CONSUMABLE', 'FINISHED', 'WIP'];
const UOMS = ['KG', 'GM', 'LTR', 'ML', 'PCS', 'BOX', 'CTN', 'DOZ'];

const emptyForm = {
  code: '',
  name: '',
  category: 'RAW',
  uom: 'KG',
  standardRate: 0,
  reorderLevel: 0,
  shelfLifeDays: 0,
  taxRate: 18,
  hsCode: '',
  defaultLocation: 'RM Store',
  isActive: true,
  notes: '',
};

export default function MaterialsPage() {
  const qc = useQueryClient();
  const { can } = useAuth();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [opened, handlers] = useDisclosure(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);

  const { data, isLoading } = useQuery({
    queryKey: ['materials'],
    queryFn: async () => (await api.get('/materials')).data.data,
  });

  const save = useMutation({
    mutationFn: (payload) =>
      editing ? api.put('/materials/' + editing._id, payload) : api.post('/materials', payload),
    onSuccess: () => {
      showSuccess(editing ? 'Material updated' : 'Material created');
      qc.invalidateQueries({ queryKey: ['materials'] });
      handlers.close();
    },
    onError: (e) => showError(e),
  });

  const remove = useMutation({
    mutationFn: (id) => api.delete('/materials/' + id),
    onSuccess: () => {
      showSuccess('Material removed');
      qc.invalidateQueries({ queryKey: ['materials'] });
    },
    onError: (e) => showError(e),
  });

  const rows = useMemo(() => {
    let list = data || [];
    if (category) list = list.filter((m) => m.category === category);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((m) => m.name.toLowerCase().includes(q) || m.code.toLowerCase().includes(q));
    }
    return list;
  }, [data, search, category]);

  const totals = useMemo(() => {
    const list = data || [];
    return {
      count: list.length,
      value: list.reduce((s, m) => s + (m.stockValue || 0), 0),
      low: list.filter((m) => m.reorderLevel > 0 && m.onHand <= m.reorderLevel).length,
      inactive: list.filter((m) => !m.isActive).length,
    };
  }, [data]);

  const openNew = () => {
    setEditing(null);
    setForm(emptyForm);
    handlers.open();
  };

  const openEdit = (m) => {
    setEditing(m);
    setForm({ ...emptyForm, ...m });
    handlers.open();
  };

  if (isLoading) return <Loading label="Loading materials" />;

  return (
    <PageTransition>
      <PageHeader
        icon={IconCookie}
        title="Material master"
        subtitle="Raw materials, packaging, consumables and finished items. The standard rate seeds new recipe lines; the moving average values every issue."
        actions={
          <Group gap="xs">
            <ExportMenu reportKey="inventory-valuation" label="Export valuation" />
            {can('material.manage') && (
              <Button leftSection={<IconPlus size={16} />} onClick={openNew}>
                New material
              </Button>
            )}
          </Group>
        }
      />

      <SimpleGrid cols={{ base: 2, md: 4 }} spacing="md" mb="md">
        <StatCard label="Items" value={totals.count} compact />
        <StatCard label="Stock value" value={money(totals.value, 0)} compact color="teal" />
        <StatCard label="Below reorder" value={totals.low} compact color={totals.low ? 'red' : 'gray'} />
        <StatCard label="Inactive" value={totals.inactive} compact color="gray" />
      </SimpleGrid>

      <Card mb="md" p="sm">
        <Group wrap="wrap" gap="sm">
          <TextInput
            placeholder="Search name or code"
            leftSection={<IconSearch size={15} />}
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
            style={{ flex: 1, minWidth: 200 }}
          />
          <Select
            placeholder="All categories"
            data={CATEGORIES}
            value={category}
            onChange={setCategory}
            clearable
            w={180}
          />
        </Group>
      </Card>

      {!rows.length ? (
        <EmptyState title="No materials match" icon={IconCookie} />
      ) : (
        <Section>
          <Table.ScrollContainer minWidth={980}>
            <Table highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Code</Table.Th>
                  <Table.Th>Name</Table.Th>
                  <Table.Th>Category</Table.Th>
                  <Table.Th>UOM</Table.Th>
                  <Table.Th ta="right">Standard rate</Table.Th>
                  <Table.Th ta="right">Moving avg</Table.Th>
                  <Table.Th ta="right">On hand</Table.Th>
                  <Table.Th ta="right">Stock value</Table.Th>
                  <Table.Th ta="right">Reorder</Table.Th>
                  <Table.Th ta="right">Tax %</Table.Th>
                  {can('material.manage') && <Table.Th />}
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {rows.map((m) => {
                  const low = m.reorderLevel > 0 && m.onHand <= m.reorderLevel;
                  return (
                    <Table.Tr key={m._id} opacity={m.isActive ? 1 : 0.5}>
                      <Table.Td>
                        <Text size="sm" ff="monospace" fw={600}>
                          {m.code}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm">{m.name}</Text>
                        <Text size="10px" c="dimmed">
                          {m.defaultLocation}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <Badge size="sm" variant="light" color={m.category === 'FINISHED' ? 'teal' : 'gray'}>
                          {m.category}
                        </Badge>
                      </Table.Td>
                      <Table.Td>{m.uom}</Table.Td>
                      <Table.Td ta="right" ff="monospace">
                        {num(m.standardRate, 2)}
                      </Table.Td>
                      <Table.Td ta="right" ff="monospace">
                        {num(m.movingAvgRate, 2)}
                      </Table.Td>
                      <Table.Td ta="right" ff="monospace" fw={600} c={low ? 'red.6' : undefined}>
                        {num(m.onHand, 2)}
                      </Table.Td>
                      <Table.Td ta="right" ff="monospace">
                        {num(m.stockValue, 0)}
                      </Table.Td>
                      <Table.Td ta="right" c="dimmed">
                        {m.reorderLevel ? num(m.reorderLevel, 0) : '-'}
                      </Table.Td>
                      <Table.Td ta="right" c="dimmed">
                        {m.taxRate}%
                      </Table.Td>
                      {can('material.manage') && (
                        <Table.Td>
                          <Group gap={2} justify="flex-end" wrap="nowrap">
                            <Tooltip label="Edit">
                              <ActionIcon variant="subtle" onClick={() => openEdit(m)}>
                                <IconEdit size={16} />
                              </ActionIcon>
                            </Tooltip>
                            <Tooltip label="Delete">
                              <ActionIcon variant="subtle" color="red" onClick={() => remove.mutate(m._id)}>
                                <IconTrash size={16} />
                              </ActionIcon>
                            </Tooltip>
                          </Group>
                        </Table.Td>
                      )}
                    </Table.Tr>
                  );
                })}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </Section>
      )}

      <Modal
        opened={opened}
        onClose={handlers.close}
        title={editing ? 'Edit ' + editing.name : 'New material'}
        size="lg"
      >
        <Stack>
          <SimpleGrid cols={{ base: 1, xs: 2 }}>
            <TextInput
              label="Code"
              placeholder="Generated automatically if blank"
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.currentTarget.value })}
              disabled={!!editing}
            />
            <TextInput
              label="Name"
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.currentTarget.value })}
            />
            <Select
              label="Category"
              data={CATEGORIES}
              value={form.category}
              onChange={(v) => setForm({ ...form, category: v })}
            />
            <Select label="UOM" data={UOMS} value={form.uom} onChange={(v) => setForm({ ...form, uom: v })} />
            <NumberInput
              label="Standard rate"
              value={form.standardRate}
              onChange={(v) => setForm({ ...form, standardRate: v })}
              min={0}
              decimalScale={4}
              prefix="Rs. "
            />
            <NumberInput
              label="Reorder level"
              value={form.reorderLevel}
              onChange={(v) => setForm({ ...form, reorderLevel: v })}
              min={0}
            />
            <NumberInput
              label="Sales tax %"
              value={form.taxRate}
              onChange={(v) => setForm({ ...form, taxRate: v })}
              min={0}
              max={100}
              suffix="%"
            />
            <NumberInput
              label="Shelf life (days)"
              value={form.shelfLifeDays}
              onChange={(v) => setForm({ ...form, shelfLifeDays: v })}
              min={0}
            />
            <TextInput
              label="Default location"
              value={form.defaultLocation}
              onChange={(e) => setForm({ ...form, defaultLocation: e.currentTarget.value })}
            />
            <TextInput
              label="HS code"
              value={form.hsCode}
              onChange={(e) => setForm({ ...form, hsCode: e.currentTarget.value })}
            />
          </SimpleGrid>

          <Textarea
            label="Notes"
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.currentTarget.value })}
            minRows={2}
          />
          <Switch
            label="Active"
            checked={form.isActive}
            onChange={(e) => setForm({ ...form, isActive: e.currentTarget.checked })}
          />

          <Group justify="flex-end">
            <Button variant="default" onClick={handlers.close}>
              Cancel
            </Button>
            <Button loading={save.isPending} onClick={() => save.mutate(form)}>
              {editing ? 'Save changes' : 'Create material'}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </PageTransition>
  );
}
