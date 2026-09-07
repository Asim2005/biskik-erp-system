import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  Badge,
  Button,
  Card,
  Group,
  Modal,
  ScrollArea,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  ThemeIcon,
  Title,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import {
  IconClipboardList,
  IconEye,
  IconFileTypeCsv,
  IconFileTypePdf,
  IconInfoCircle,
} from '@tabler/icons-react';
import { api, downloadReport, showError, showSuccess } from '../api/client';
import { Loading, PageHeader, PageTransition, Section } from '../components/ui';
import { num } from '../utils/format';

export default function ReportsPage() {
  const [preview, setPreview] = useState(null);
  const [opened, handlers] = useDisclosure(false);
  const [busy, setBusy] = useState('');
  const [recipeId, setRecipeId] = useState(null);
  const [orderId, setOrderId] = useState(null);
  const [accountId, setAccountId] = useState(null);

  const { data: reports, isLoading } = useQuery({
    queryKey: ['reports'],
    queryFn: async () => (await api.get('/reports')).data.data,
  });

  const { data: recipes } = useQuery({
    queryKey: ['recipes'],
    queryFn: async () => (await api.get('/recipes')).data.data,
  });

  const { data: orders } = useQuery({
    queryKey: ['production'],
    queryFn: async () => (await api.get('/production')).data.data,
  });

  const { data: accounts } = useQuery({
    queryKey: ['accounts'],
    queryFn: async () => (await api.get('/accounts')).data.data,
  });

  const paramsFor = (key) => {
    if (key === 'recipe-cost-sheet') return { id: recipeId };
    if (key === 'production-variance') return { id: orderId };
    if (key === 'ledger') return { account: accountId };
    return {};
  };

  const missingParam = (key) => {
    if (key === 'recipe-cost-sheet' && !recipeId) return 'Pick a recipe below first';
    if (key === 'production-variance' && !orderId) return 'Pick a production order below first';
    if (key === 'ledger' && !accountId) return 'Pick an account below first';
    return null;
  };

  const run = async (key, format) => {
    const missing = missingParam(key);
    if (missing) return showError({ friendly: missing }, 'Choose a subject');
    setBusy(key + format);
    try {
      const name = await downloadReport(key, { format, params: paramsFor(key) });
      showSuccess(name + ' downloaded', 'Export ready');
    } catch (e) {
      showError(e, 'Export failed');
    } finally {
      setBusy('');
    }
    return undefined;
  };

  const openPreview = async (key) => {
    const missing = missingParam(key);
    if (missing) return showError({ friendly: missing }, 'Choose a subject');
    setBusy(key + 'view');
    try {
      const res = await api.get('/reports/' + key, { params: paramsFor(key) });
      setPreview(res.data);
      handlers.open();
    } catch (e) {
      showError(e, 'Could not run the report');
    } finally {
      setBusy('');
    }
    return undefined;
  };

  if (isLoading) return <Loading label="Loading reports" />;

  return (
    <PageTransition>
      <PageHeader
        icon={IconClipboardList}
        title="Reports"
        subtitle="Every report runs off live postings and can be viewed on screen, exported to CSV for Excel, or rendered as a print-ready PDF."
      />

      <Alert color="blue" variant="light" icon={<IconInfoCircle size={18} />} mb="md">
        Three reports need a subject. Choose one below and they become available.
      </Alert>

      <Card mb="md" p="md">
        <SimpleGrid cols={{ base: 1, md: 3 }} spacing="sm">
          <Select
            label="Recipe (for the cost sheet)"
            placeholder="Choose a recipe"
            data={(recipes || []).map((r) => ({
              value: r._id,
              label: r.code + ' v' + r.version + ' — ' + r.productName,
            }))}
            value={recipeId}
            onChange={setRecipeId}
            searchable
            clearable
          />
          <Select
            label="Production order (for variance)"
            placeholder="Choose an order"
            data={(orders || []).map((o) => ({ value: o._id, label: o.code + ' — ' + o.productName }))}
            value={orderId}
            onChange={setOrderId}
            searchable
            clearable
          />
          <Select
            label="Account (for the ledger)"
            placeholder="Choose an account"
            data={(accounts || []).map((a) => ({ value: a._id, label: a.code + ' - ' + a.name }))}
            value={accountId}
            onChange={setAccountId}
            searchable
            clearable
          />
        </SimpleGrid>
      </Card>

      <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md">
        {(reports || []).map((r) => {
          const missing = missingParam(r.key);
          return (
            <Card key={r.key} className="erp-lift" p="md" h="100%">
              <Stack justify="space-between" h="100%" gap="sm">
                <div>
                  <Group justify="space-between" align="flex-start" mb={6}>
                    <ThemeIcon variant="light" color="biscuit" size={34} radius="md">
                      <IconClipboardList size={18} />
                    </ThemeIcon>
                    {r.needsId && (
                      <Badge size="xs" variant="light" color={missing ? 'orange' : 'teal'}>
                        {missing ? 'needs a subject' : 'ready'}
                      </Badge>
                    )}
                  </Group>
                  <Text fw={700} size="sm">
                    {r.title}
                  </Text>
                  <Text size="xs" c="dimmed" mt={2}>
                    {r.subtitle}
                  </Text>
                </div>

                <Group gap={6} wrap="nowrap">
                  <Button
                    size="compact-sm"
                    variant="light"
                    leftSection={<IconEye size={14} />}
                    loading={busy === r.key + 'view'}
                    onClick={() => openPreview(r.key)}
                    style={{ flex: 1 }}
                  >
                    View
                  </Button>
                  <Button
                    size="compact-sm"
                    variant="default"
                    leftSection={<IconFileTypeCsv size={14} />}
                    loading={busy === r.key + 'csv'}
                    onClick={() => run(r.key, 'csv')}
                  >
                    CSV
                  </Button>
                  <Button
                    size="compact-sm"
                    variant="default"
                    leftSection={<IconFileTypePdf size={14} />}
                    loading={busy === r.key + 'pdf'}
                    onClick={() => run(r.key, 'pdf')}
                  >
                    PDF
                  </Button>
                </Group>
              </Stack>
            </Card>
          );
        })}
      </SimpleGrid>

      {/* ---------------------------- preview modal -------------------------- */}
      <Modal opened={opened} onClose={handlers.close} title={preview?.title} size="95%">
        {preview && (
          <Stack>
            <Text size="sm" c="dimmed">
              {preview.subtitle}
            </Text>

            {preview.meta?.length > 0 && (
              <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="xs">
                {preview.meta.map((m) => (
                  <Card key={m.label} withBorder p="xs">
                    <Text size="10px" c="dimmed" tt="uppercase" fw={700}>
                      {m.label}
                    </Text>
                    <Text size="sm" fw={700}>
                      {String(m.value ?? '-')}
                    </Text>
                  </Card>
                ))}
              </SimpleGrid>
            )}

            <ScrollArea h={420} type="auto" data-lenis-prevent>
              <Table striped highlightOnHover fz="xs" stickyHeader>
                <Table.Thead>
                  <Table.Tr>
                    {preview.columns.map((c) => (
                      <Table.Th key={c.key + c.title} ta={c.align}>
                        {c.title}
                      </Table.Th>
                    ))}
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {preview.data.map((row, i) => (
                    <Table.Tr key={i} style={row.__bold ? { fontWeight: 700 } : undefined}>
                      {preview.columns.map((c) => {
                        const v = row[c.key];
                        return (
                          <Table.Td key={c.key} ta={c.align}>
                            {typeof v === 'number' ? (
                              <Text size="xs" ff="monospace">
                                {num(v, 2)}
                              </Text>
                            ) : (
                              String(v ?? '')
                            )}
                          </Table.Td>
                        );
                      })}
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </ScrollArea>

            {preview.totals?.length > 0 && (
              <Card withBorder p="sm">
                <Stack gap={4}>
                  {preview.totals.map((t) => (
                    <Group key={t.label} justify="space-between">
                      <Text size="sm" c="dimmed">
                        {t.label}
                      </Text>
                      <Text size="sm" fw={700} ff="monospace" c={t.tone === 'bad' ? 'red.6' : t.tone === 'good' ? 'teal.7' : undefined}>
                        {t.value}
                      </Text>
                    </Group>
                  ))}
                </Stack>
              </Card>
            )}

            {preview.notes?.length > 0 && (
              <Alert color="gray" variant="light" p="xs">
                <Stack gap={2}>
                  {preview.notes.map((n) => (
                    <Text key={n} size="xs">
                      • {n}
                    </Text>
                  ))}
                </Stack>
              </Alert>
            )}

            <Group justify="flex-end">
              <Button
                variant="default"
                leftSection={<IconFileTypeCsv size={16} />}
                onClick={() => run(preview.key, 'csv')}
              >
                Download CSV
              </Button>
              <Button leftSection={<IconFileTypePdf size={16} />} onClick={() => run(preview.key, 'pdf')}>
                Download PDF
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </PageTransition>
  );
}
