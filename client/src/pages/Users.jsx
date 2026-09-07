import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ActionIcon,
  Avatar,
  Badge,
  Button,
  Card,
  Group,
  Modal,
  PasswordInput,
  ScrollArea,
  SimpleGrid,
  Stack,
  Switch,
  Table,
  Tabs,
  Text,
  TextInput,
  ThemeIcon,
  Tooltip,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import {
  IconCheck,
  IconEdit,
  IconHistory,
  IconPlus,
  IconShieldLock,
  IconTrash,
  IconUserCog,
  IconUsers,
} from '@tabler/icons-react';
import { Select } from '@mantine/core';
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
import { dateTime, fromNow, humanise } from '../utils/format';

const emptyForm = { name: '', email: '', password: '', role: 'viewer', department: '', phone: '', isActive: true };

export default function UsersPage() {
  const qc = useQueryClient();
  const { can, user: me } = useAuth();
  const [opened, handlers] = useDisclosure(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);

  const { data, isLoading } = useQuery({
    queryKey: ['users'],
    queryFn: async () => (await api.get('/users')).data,
  });

  const { data: rolesData } = useQuery({
    queryKey: ['roles'],
    queryFn: async () => (await api.get('/users/roles')).data.roles,
  });

  const { data: audit } = useQuery({
    queryKey: ['audit'],
    queryFn: async () => (await api.get('/audit', { params: { limit: 150 } })).data.data,
    enabled: can('audit.view'),
  });

  const save = useMutation({
    mutationFn: (payload) => {
      if (editing) {
        const body = { ...payload };
        delete body.email;
        if (!body.password) delete body.password;
        return api.put('/users/' + editing._id, body);
      }
      return api.post('/users', payload);
    },
    onSuccess: () => {
      showSuccess(editing ? 'User updated' : 'User created');
      qc.invalidateQueries({ queryKey: ['users'] });
      handlers.close();
    },
    onError: (e) => showError(e),
  });

  const remove = useMutation({
    mutationFn: (id) => api.delete('/users/' + id),
    onSuccess: () => {
      showSuccess('User removed');
      qc.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (e) => showError(e),
  });

  const users = data?.data || [];
  const roleOptions = useMemo(
    () => (rolesData || []).map((r) => ({ value: r.value, label: r.label })),
    [rolesData]
  );

  const openNew = () => {
    setEditing(null);
    setForm(emptyForm);
    handlers.open();
  };

  const openEdit = (u) => {
    setEditing(u);
    setForm({ ...emptyForm, ...u, password: '' });
    handlers.open();
  };

  if (isLoading) return <Loading label="Loading users" />;

  return (
    <PageTransition>
      <PageHeader
        icon={IconUserCog}
        title="Users and roles"
        subtitle="Each role carries a fixed set of permissions. The API enforces them on every request, so hiding a button is never the only control."
        actions={
          can('user.manage') && (
            <Button leftSection={<IconPlus size={16} />} onClick={openNew}>
              New user
            </Button>
          )
        }
      />

      <SimpleGrid cols={{ base: 2, md: 4 }} spacing="md" mb="md">
        <StatCard label="Users" value={users.length} compact />
        <StatCard label="Active" value={users.filter((u) => u.isActive).length} compact color="teal" />
        <StatCard label="Roles" value={rolesData?.length || 0} compact />
        <StatCard label="Audit events" value={audit?.length || 0} compact color="grape" />
      </SimpleGrid>

      <Tabs defaultValue="users" keepMounted={false}>
        <Tabs.List mb="md">
          <Tabs.Tab value="users" leftSection={<IconUsers size={16} />}>
            Users
          </Tabs.Tab>
          <Tabs.Tab value="roles" leftSection={<IconShieldLock size={16} />}>
            Role permissions
          </Tabs.Tab>
          {can('audit.view') && (
            <Tabs.Tab value="audit" leftSection={<IconHistory size={16} />}>
              Audit trail
            </Tabs.Tab>
          )}
        </Tabs.List>

        <Tabs.Panel value="users">
          <Section>
            <Table.ScrollContainer minWidth={780}>
              <Table highlightOnHover>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>User</Table.Th>
                    <Table.Th>Role</Table.Th>
                    <Table.Th>Department</Table.Th>
                    <Table.Th>Status</Table.Th>
                    <Table.Th>Last sign in</Table.Th>
                    {can('user.manage') && <Table.Th />}
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {users.map((u) => (
                    <Table.Tr key={u._id}>
                      <Table.Td>
                        <Group gap="sm" wrap="nowrap">
                          <Avatar color="biscuit" radius="xl" size={32}>
                            {u.name
                              .split(' ')
                              .map((p) => p[0])
                              .slice(0, 2)
                              .join('')
                              .toUpperCase()}
                          </Avatar>
                          <div>
                            <Text size="sm" fw={600}>
                              {u.name}
                              {u._id === me?.id && (
                                <Badge ml={6} size="xs" variant="light">
                                  you
                                </Badge>
                              )}
                            </Text>
                            <Text size="10px" c="dimmed">
                              {u.email}
                            </Text>
                          </div>
                        </Group>
                      </Table.Td>
                      <Table.Td>
                        <Badge variant="light" color={u.role === 'admin' ? 'red' : 'gray'}>
                          {data.roleLabels?.[u.role] || u.role}
                        </Badge>
                      </Table.Td>
                      <Table.Td>
                        <Text size="xs" c="dimmed">
                          {u.department || '-'}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <Badge size="sm" variant="dot" color={u.isActive ? 'teal' : 'gray'}>
                          {u.isActive ? 'active' : 'disabled'}
                        </Badge>
                      </Table.Td>
                      <Table.Td>
                        <Text size="xs" c="dimmed">
                          {u.lastLoginAt ? fromNow(u.lastLoginAt) : 'never'}
                        </Text>
                      </Table.Td>
                      {can('user.manage') && (
                        <Table.Td>
                          <Group gap={2} justify="flex-end" wrap="nowrap">
                            <Tooltip label="Edit">
                              <ActionIcon variant="subtle" onClick={() => openEdit(u)}>
                                <IconEdit size={16} />
                              </ActionIcon>
                            </Tooltip>
                            <Tooltip label="Delete">
                              <ActionIcon
                                variant="subtle"
                                color="red"
                                disabled={u._id === me?.id}
                                onClick={() => remove.mutate(u._id)}
                              >
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
        </Tabs.Panel>

        <Tabs.Panel value="roles">
          <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
            {(rolesData || []).map((r) => (
              <Card key={r.value} p="md">
                <Group justify="space-between" mb="sm">
                  <Group gap="sm">
                    <ThemeIcon variant="light" color={r.value === 'admin' ? 'red' : 'biscuit'} size={34} radius="md">
                      <IconShieldLock size={18} />
                    </ThemeIcon>
                    <div>
                      <Text fw={700} size="sm">
                        {r.label}
                      </Text>
                      <Text size="10px" c="dimmed" ff="monospace">
                        {r.value}
                      </Text>
                    </div>
                  </Group>
                  <Badge variant="light">{r.permissionCount} permissions</Badge>
                </Group>
                <ScrollArea h={160} type="auto" data-lenis-prevent>
                  <SimpleGrid cols={2} spacing={2}>
                    {r.permissions.map((p) => (
                      <Group key={p} gap={4} wrap="nowrap">
                        <IconCheck size={11} color="var(--mantine-color-teal-6)" style={{ flexShrink: 0 }} />
                        <Text size="10px" ff="monospace" truncate>
                          {p}
                        </Text>
                      </Group>
                    ))}
                  </SimpleGrid>
                </ScrollArea>
              </Card>
            ))}
          </SimpleGrid>
        </Tabs.Panel>

        {can('audit.view') && (
          <Tabs.Panel value="audit">
            <Section title="Audit trail" description="Who did what, and when. Written on every state change.">
              {audit?.length ? (
                <Table.ScrollContainer minWidth={780}>
                  <Table highlightOnHover fz="xs">
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>When</Table.Th>
                        <Table.Th>User</Table.Th>
                        <Table.Th>Action</Table.Th>
                        <Table.Th>Entity</Table.Th>
                        <Table.Th>Detail</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {audit.map((a) => (
                        <Table.Tr key={a._id}>
                          <Table.Td>
                            <Text size="10px" c="dimmed">
                              {dateTime(a.createdAt)}
                            </Text>
                          </Table.Td>
                          <Table.Td>
                            <Text size="xs">{a.userName || 'system'}</Text>
                            <Text size="10px" c="dimmed">
                              {humanise(a.userRole)}
                            </Text>
                          </Table.Td>
                          <Table.Td>
                            <Badge size="xs" variant="light">
                              {a.action}
                            </Badge>
                          </Table.Td>
                          <Table.Td>
                            <Text size="xs" ff="monospace">
                              {a.entityCode || a.entity || '-'}
                            </Text>
                          </Table.Td>
                          <Table.Td>
                            <Text size="10px" c="dimmed">
                              {a.detail}
                            </Text>
                          </Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </Table.ScrollContainer>
              ) : (
                <EmptyState title="Nothing logged yet" icon={IconHistory} />
              )}
            </Section>
          </Tabs.Panel>
        )}
      </Tabs>

      <Modal opened={opened} onClose={handlers.close} title={editing ? 'Edit ' + editing.name : 'New user'}>
        <Stack>
          <TextInput
            label="Name"
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.currentTarget.value })}
          />
          <TextInput
            label="Email"
            required
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.currentTarget.value })}
            disabled={!!editing}
          />
          <PasswordInput
            label={editing ? 'New password (leave blank to keep)' : 'Password'}
            required={!editing}
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.currentTarget.value })}
          />
          <Select
            label="Role"
            data={roleOptions}
            value={form.role}
            onChange={(v) => setForm({ ...form, role: v })}
            disabled={editing?._id === me?.id}
          />
          <SimpleGrid cols={2}>
            <TextInput
              label="Department"
              value={form.department}
              onChange={(e) => setForm({ ...form, department: e.currentTarget.value })}
            />
            <TextInput
              label="Phone"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.currentTarget.value })}
            />
          </SimpleGrid>
          <Switch
            label="Active"
            checked={form.isActive}
            onChange={(e) => setForm({ ...form, isActive: e.currentTarget.checked })}
            disabled={editing?._id === me?.id}
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={handlers.close}>
              Cancel
            </Button>
            <Button loading={save.isPending} onClick={() => save.mutate(form)}>
              {editing ? 'Save changes' : 'Create user'}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </PageTransition>
  );
}
