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
  SegmentedControl,
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
import { IconEdit, IconPlus, IconSearch, IconTrash, IconUsersGroup } from '@tabler/icons-react';
import { api, showError, showSuccess } from '../api/client';
import { useAuth } from '../context/AuthContext';
import {
  EmptyState,
  Loading,
  PageHeader,
  PageTransition,
  Section,
  StatCard,
} from '../components/ui';
import { money } from '../utils/format';

const emptyForm = {
  type: 'CUSTOMER',
  name: '',
  contactPerson: '',
  phone: '',
  email: '',
  address: '',
  city: '',
  ntn: '',
  strn: '',
  filerStatus: 'UNKNOWN',
  creditLimit: 0,
  creditDays: 0,
  openingBalance: 0,
  isActive: true,
};

export default function PartiesPage() {
  const qc = useQueryClient();
  const { can } = useAuth();
  const [type, setType] = useState('CUSTOMER');
  const [search, setSearch] = useState('');
  const [opened, handlers] = useDisclosure(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);

  const { data, isLoading } = useQuery({
    queryKey: ['parties'],
    queryFn: async () => (await api.get('/parties')).data.data,
  });

  const save = useMutation({
    mutationFn: (payload) => (editing ? api.put('/parties/' + editing._id, payload) : api.post('/parties', payload)),
    onSuccess: () => {
      showSuccess(editing ? 'Updated' : 'Created');
      qc.invalidateQueries({ queryKey: ['parties'] });
      handlers.close();
    },
    onError: (e) => showError(e),
  });

  const remove = useMutation({
    mutationFn: (id) => api.delete('/parties/' + id),
    onSuccess: () => {
      showSuccess('Removed');
      qc.invalidateQueries({ queryKey: ['parties'] });
    },
    onError: (e) => showError(e),
  });

  const rows = useMemo(() => {
    let list = (data || []).filter((p) => p.type === type);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((p) => p.name.toLowerCase().includes(q) || p.code.toLowerCase().includes(q));
    }
    return list;
  }, [data, type, search]);

  const totals = useMemo(() => {
    const list = (data || []).filter((p) => p.type === type);
    return {
      count: list.length,
      balance: list.reduce((s, p) => s + (p.balance || 0), 0),
      filers: list.filter((p) => p.filerStatus === 'FILER').length,
    };
  }, [data, type]);

  const openNew = () => {
    setEditing(null);
    setForm({ ...emptyForm, type });
    handlers.open();
  };

  const openEdit = (p) => {
    setEditing(p);
    setForm({ ...emptyForm, ...p });
    handlers.open();
  };

  if (isLoading) return <Loading label="Loading parties" />;

  const isCustomer = type === 'CUSTOMER';

  return (
    <PageTransition>
      <PageHeader
        icon={IconUsersGroup}
        title="Customers and suppliers"
        subtitle="Tax registration details captured here flow through to the sales tax register."
        actions={
          can('party.manage') && (
            <Button leftSection={<IconPlus size={16} />} onClick={openNew}>
              New {isCustomer ? 'customer' : 'supplier'}
            </Button>
          )
        }
      />

      <SimpleGrid cols={{ base: 3 }} spacing="md" mb="md">
        <StatCard label={isCustomer ? 'Customers' : 'Suppliers'} value={totals.count} compact />
        <StatCard
          label={isCustomer ? 'Receivable' : 'Payable'}
          value={money(totals.balance, 0)}
          compact
          color={isCustomer ? 'teal' : 'orange'}
        />
        <StatCard label="Registered filers" value={totals.filers} compact />
      </SimpleGrid>

      <Card mb="md" p="sm">
        <Group justify="space-between" wrap="wrap" gap="sm">
          <SegmentedControl
            value={type}
            onChange={setType}
            data={[
              { label: 'Customers', value: 'CUSTOMER' },
              { label: 'Suppliers', value: 'SUPPLIER' },
            ]}
          />
          <TextInput
            placeholder="Search name or code"
            leftSection={<IconSearch size={15} />}
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
            w={{ base: '100%', sm: 260 }}
          />
        </Group>
      </Card>

      {!rows.length ? (
        <EmptyState title="Nothing here" icon={IconUsersGroup} />
      ) : (
        <Section>
          <Table.ScrollContainer minWidth={880}>
            <Table highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Code</Table.Th>
                  <Table.Th>Name</Table.Th>
                  <Table.Th>City</Table.Th>
                  <Table.Th>NTN / STRN</Table.Th>
                  <Table.Th>Filer</Table.Th>
                  <Table.Th ta="right">Credit limit</Table.Th>
                  <Table.Th ta="right">Days</Table.Th>
                  <Table.Th ta="right">Balance</Table.Th>
                  {can('party.manage') && <Table.Th />}
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {rows.map((p) => (
                  <Table.Tr key={p._id} opacity={p.isActive ? 1 : 0.5}>
                    <Table.Td ff="monospace" fw={600}>
                      {p.code}
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm">{p.name}</Text>
                      {p.contactPerson && (
                        <Text size="10px" c="dimmed">
                          {p.contactPerson} {p.phone && '· ' + p.phone}
                        </Text>
                      )}
                    </Table.Td>
                    <Table.Td>{p.city || '-'}</Table.Td>
                    <Table.Td>
                      <Text size="xs" ff="monospace">
                        {p.ntn || '-'}
                      </Text>
                      <Text size="10px" c="dimmed" ff="monospace">
                        {p.strn || ''}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Badge
                        size="xs"
                        variant="light"
                        color={p.filerStatus === 'FILER' ? 'teal' : p.filerStatus === 'NON_FILER' ? 'orange' : 'gray'}
                      >
                        {p.filerStatus.replace('_', ' ').toLowerCase()}
                      </Badge>
                    </Table.Td>
                    <Table.Td ta="right" ff="monospace">
                      {p.creditLimit ? money(p.creditLimit, 0) : '-'}
                    </Table.Td>
                    <Table.Td ta="right">{p.creditDays || '-'}</Table.Td>
                    <Table.Td ta="right" ff="monospace" fw={600}>
                      {money(p.balance, 0)}
                    </Table.Td>
                    {can('party.manage') && (
                      <Table.Td>
                        <Group gap={2} justify="flex-end" wrap="nowrap">
                          <Tooltip label="Edit">
                            <ActionIcon variant="subtle" onClick={() => openEdit(p)}>
                              <IconEdit size={16} />
                            </ActionIcon>
                          </Tooltip>
                          <Tooltip label="Delete">
                            <ActionIcon variant="subtle" color="red" onClick={() => remove.mutate(p._id)}>
                              <IconTrash size={16} />
                            </ActionIcon>
                          </Tooltip>
                        </Group>
                      </Table.Td>
                    )}
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </Section>
      )}

      <Modal opened={opened} onClose={handlers.close} title={editing ? 'Edit ' + editing.name : 'New party'} size="lg">
        <Stack>
          <SimpleGrid cols={{ base: 1, xs: 2 }}>
            <Select
              label="Type"
              data={[
                { value: 'CUSTOMER', label: 'Customer' },
                { value: 'SUPPLIER', label: 'Supplier' },
              ]}
              value={form.type}
              onChange={(v) => setForm({ ...form, type: v })}
              disabled={!!editing}
            />
            <TextInput
              label="Name"
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.currentTarget.value })}
            />
            <TextInput
              label="Contact person"
              value={form.contactPerson}
              onChange={(e) => setForm({ ...form, contactPerson: e.currentTarget.value })}
            />
            <TextInput
              label="Phone"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.currentTarget.value })}
            />
            <TextInput
              label="Email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.currentTarget.value })}
            />
            <TextInput
              label="City"
              value={form.city}
              onChange={(e) => setForm({ ...form, city: e.currentTarget.value })}
            />
            <TextInput
              label="NTN"
              value={form.ntn}
              onChange={(e) => setForm({ ...form, ntn: e.currentTarget.value })}
            />
            <TextInput
              label="STRN"
              value={form.strn}
              onChange={(e) => setForm({ ...form, strn: e.currentTarget.value })}
            />
            <Select
              label="Filer status"
              data={[
                { value: 'FILER', label: 'Filer' },
                { value: 'NON_FILER', label: 'Non-filer' },
                { value: 'UNKNOWN', label: 'Unknown' },
              ]}
              value={form.filerStatus}
              onChange={(v) => setForm({ ...form, filerStatus: v })}
            />
            <NumberInput
              label="Credit limit"
              value={form.creditLimit}
              onChange={(v) => setForm({ ...form, creditLimit: v })}
              min={0}
              thousandSeparator
              prefix="Rs. "
            />
            <NumberInput
              label="Credit days"
              value={form.creditDays}
              onChange={(v) => setForm({ ...form, creditDays: v })}
              min={0}
            />
            <NumberInput
              label="Opening balance"
              value={form.openingBalance}
              onChange={(v) => setForm({ ...form, openingBalance: v })}
              thousandSeparator
              prefix="Rs. "
              disabled={!!editing}
            />
          </SimpleGrid>

          <Textarea
            label="Address"
            value={form.address}
            onChange={(e) => setForm({ ...form, address: e.currentTarget.value })}
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
              {editing ? 'Save changes' : 'Create'}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </PageTransition>
  );
}
