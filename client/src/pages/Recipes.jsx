import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ActionIcon,
  Badge,
  Button,
  Card,
  Group,
  Menu,
  Modal,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Textarea,
  TextInput,
  Tooltip,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import {
  IconCheck,
  IconChefHat,
  IconCopyPlus,
  IconDotsVertical,
  IconEdit,
  IconFileTypePdf,
  IconPlus,
  IconSearch,
  IconSend,
  IconTrash,
  IconX,
} from '@tabler/icons-react';
import { api, downloadReport, showError, showSuccess } from '../api/client';
import { useAuth } from '../context/AuthContext';
import {
  EmptyState,
  Loading,
  PageHeader,
  PageTransition,
  Section,
  StatusBadge,
} from '../components/ui';
import { date, money } from '../utils/format';

export default function RecipesPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { can } = useAuth();
  const [status, setStatus] = useState('ALL');
  const [search, setSearch] = useState('');
  const [rejectFor, setRejectFor] = useState(null);
  const [reason, setReason] = useState('');
  const [versionFor, setVersionFor] = useState(null);
  const [changeNote, setChangeNote] = useState('');
  const [rejectOpen, rejectHandlers] = useDisclosure(false);
  const [versionOpen, versionHandlers] = useDisclosure(false);

  const { data, isLoading } = useQuery({
    queryKey: ['recipes'],
    queryFn: async () => (await api.get('/recipes')).data.data,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['recipes'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
  };

  const act = useMutation({
    mutationFn: ({ id, action, body }) => api.post('/recipes/' + id + '/' + action, body || {}),
    onSuccess: (res) => {
      showSuccess(res.data.message || 'Done');
      invalidate();
    },
    onError: (e) => showError(e),
  });

  const remove = useMutation({
    mutationFn: (id) => api.delete('/recipes/' + id),
    onSuccess: () => {
      showSuccess('Recipe deleted');
      invalidate();
    },
    onError: (e) => showError(e),
  });

  const rows = useMemo(() => {
    let list = data || [];
    if (status !== 'ALL') list = list.filter((r) => r.status === status);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (r) => r.productName.toLowerCase().includes(q) || r.code.toLowerCase().includes(q)
      );
    }
    return list;
  }, [data, status, search]);

  const counts = useMemo(() => {
    const c = { ALL: data?.length || 0 };
    (data || []).forEach((r) => {
      c[r.status] = (c[r.status] || 0) + 1;
    });
    return c;
  }, [data]);

  const submitReject = () => {
    act.mutate({ id: rejectFor._id, action: 'reject', body: { reason } });
    rejectHandlers.close();
    setReason('');
  };

  const submitVersion = async () => {
    try {
      const res = await api.post('/recipes/' + versionFor._id + '/new-version', { changeNote });
      showSuccess('Version ' + res.data.data.version + ' created as a draft');
      versionHandlers.close();
      setChangeNote('');
      invalidate();
      navigate('/recipes/' + res.data.data._id);
    } catch (e) {
      showError(e);
    }
  };

  if (isLoading) return <Loading label="Loading recipes" />;

  return (
    <PageTransition>
      <PageHeader
        icon={IconChefHat}
        title="Recipe management"
        subtitle="Formulas are version controlled. A version must be approved by an authorised user other than the person who submitted it before production can consume it."
        actions={
          can('recipe.create') && (
            <Button leftSection={<IconPlus size={16} />} onClick={() => navigate('/recipes/new')}>
              New recipe
            </Button>
          )
        }
      />

      <Card mb="md" p="sm">
        <Group justify="space-between" wrap="wrap" gap="sm">
          <SegmentedControl
            size="xs"
            value={status}
            onChange={setStatus}
            data={[
              { label: 'All (' + (counts.ALL || 0) + ')', value: 'ALL' },
              { label: 'Draft (' + (counts.DRAFT || 0) + ')', value: 'DRAFT' },
              { label: 'Pending (' + (counts.PENDING_APPROVAL || 0) + ')', value: 'PENDING_APPROVAL' },
              { label: 'Approved (' + (counts.APPROVED || 0) + ')', value: 'APPROVED' },
              { label: 'Archived (' + (counts.ARCHIVED || 0) + ')', value: 'ARCHIVED' },
            ]}
          />
          <TextInput
            placeholder="Search product or code"
            leftSection={<IconSearch size={15} />}
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
            w={{ base: '100%', sm: 260 }}
          />
        </Group>
      </Card>

      {!rows.length ? (
        <EmptyState
          title="No recipes match"
          description="Adjust the filter, or create the first formula for this product."
          icon={IconChefHat}
          action={
            can('recipe.create') && (
              <Button onClick={() => navigate('/recipes/new')} leftSection={<IconPlus size={16} />}>
                New recipe
              </Button>
            )
          }
        />
      ) : (
        <Section>
          <Table.ScrollContainer minWidth={940}>
            <Table highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Recipe</Table.Th>
                  <Table.Th>Product</Table.Th>
                  <Table.Th>Ver.</Table.Th>
                  <Table.Th>Status</Table.Th>
                  <Table.Th ta="right">Batch</Table.Th>
                  <Table.Th ta="right">Yield</Table.Th>
                  <Table.Th ta="right">Material / unit</Table.Th>
                  <Table.Th ta="right">Mfg cost / unit</Table.Th>
                  <Table.Th>Approved by</Table.Th>
                  <Table.Th />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {rows.map((r) => (
                  <Table.Tr key={r._id}>
                    <Table.Td>
                      <Text
                        size="sm"
                        fw={700}
                        ff="monospace"
                        style={{ cursor: 'pointer' }}
                        onClick={() => navigate('/recipes/' + r._id)}
                      >
                        {r.code}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm">{r.productName}</Text>
                      {r.changeNote && (
                        <Text size="10px" c="dimmed" lineClamp={1} maw={240}>
                          {r.changeNote}
                        </Text>
                      )}
                    </Table.Td>
                    <Table.Td>
                      <Badge size="sm" variant="outline" color="gray">
                        v{r.version}
                      </Badge>
                    </Table.Td>
                    <Table.Td>
                      <StatusBadge status={r.status} />
                    </Table.Td>
                    <Table.Td ta="right">{r.baseBatchQty.toLocaleString()}</Table.Td>
                    <Table.Td ta="right">{r.yieldPercent}%</Table.Td>
                    <Table.Td ta="right" ff="monospace">
                      {money(r.materialCostPerUnit, 4)}
                    </Table.Td>
                    <Table.Td ta="right" ff="monospace" fw={600}>
                      {money(r.manufacturingCostPerUnit, 4)}
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs">{r.approvedBy?.name || '-'}</Text>
                      <Text size="10px" c="dimmed">
                        {r.approvedAt ? date(r.approvedAt) : ''}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Group gap={2} justify="flex-end" wrap="nowrap">
                        {r.status === 'PENDING_APPROVAL' && can('recipe.approve') && (
                          <>
                            <Tooltip label="Approve">
                              <ActionIcon
                                color="teal"
                                variant="light"
                                loading={act.isPending}
                                onClick={() => act.mutate({ id: r._id, action: 'approve' })}
                              >
                                <IconCheck size={16} />
                              </ActionIcon>
                            </Tooltip>
                            <Tooltip label="Reject">
                              <ActionIcon
                                color="red"
                                variant="light"
                                onClick={() => {
                                  setRejectFor(r);
                                  rejectHandlers.open();
                                }}
                              >
                                <IconX size={16} />
                              </ActionIcon>
                            </Tooltip>
                          </>
                        )}
                        {['DRAFT', 'REJECTED'].includes(r.status) && can('recipe.submit') && (
                          <Tooltip label="Submit for approval">
                            <ActionIcon
                              color="blue"
                              variant="light"
                              onClick={() => act.mutate({ id: r._id, action: 'submit' })}
                            >
                              <IconSend size={16} />
                            </ActionIcon>
                          </Tooltip>
                        )}

                        <Menu position="bottom-end" withinPortal shadow="md">
                          <Menu.Target>
                            <ActionIcon variant="subtle" color="gray">
                              <IconDotsVertical size={16} />
                            </ActionIcon>
                          </Menu.Target>
                          <Menu.Dropdown>
                            <Menu.Item
                              leftSection={<IconEdit size={15} />}
                              onClick={() => navigate('/recipes/' + r._id)}
                            >
                              Open cost sheet
                            </Menu.Item>
                            <Menu.Item
                              leftSection={<IconFileTypePdf size={15} />}
                              onClick={() =>
                                downloadReport('recipe-cost-sheet', { format: 'pdf', params: { id: r._id } })
                                  .then((n) => showSuccess(n + ' downloaded'))
                                  .catch(showError)
                              }
                            >
                              Download cost sheet PDF
                            </Menu.Item>
                            {can('recipe.create') && (
                              <Menu.Item
                                leftSection={<IconCopyPlus size={15} />}
                                onClick={() => {
                                  setVersionFor(r);
                                  versionHandlers.open();
                                }}
                              >
                                Create next version
                              </Menu.Item>
                            )}
                            {can('recipe.delete') && r.status !== 'APPROVED' && (
                              <>
                                <Menu.Divider />
                                <Menu.Item
                                  color="red"
                                  leftSection={<IconTrash size={15} />}
                                  onClick={() => remove.mutate(r._id)}
                                >
                                  Delete
                                </Menu.Item>
                              </>
                            )}
                          </Menu.Dropdown>
                        </Menu>
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </Section>
      )}

      {/* --------------------------- reject modal --------------------------- */}
      <Modal opened={rejectOpen} onClose={rejectHandlers.close} title={'Reject ' + (rejectFor?.code || '')}>
        <Stack>
          <Textarea
            label="Reason"
            description="The preparer sees this and can correct the draft."
            placeholder="Cream ratio exceeds the approved specification"
            minRows={3}
            value={reason}
            onChange={(e) => setReason(e.currentTarget.value)}
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={rejectHandlers.close}>
              Cancel
            </Button>
            <Button color="red" onClick={submitReject} disabled={!reason.trim()}>
              Reject recipe
            </Button>
          </Group>
        </Stack>
      </Modal>

      {/* -------------------------- new version modal ----------------------- */}
      <Modal
        opened={versionOpen}
        onClose={versionHandlers.close}
        title={'New version of ' + (versionFor?.code || '')}
      >
        <Stack>
          <Text size="sm" c="dimmed">
            The current formula is copied into a fresh draft. The approved version stays live until the new one is
            approved.
          </Text>
          <Textarea
            label="What changed?"
            placeholder="Cream reduced from 5.0 to 4.6 KG per batch after the panel tasting"
            minRows={3}
            value={changeNote}
            onChange={(e) => setChangeNote(e.currentTarget.value)}
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={versionHandlers.close}>
              Cancel
            </Button>
            <Button onClick={submitVersion}>Create draft</Button>
          </Group>
        </Stack>
      </Modal>
    </PageTransition>
  );
}
