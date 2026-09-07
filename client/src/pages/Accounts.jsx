import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Accordion,
  ActionIcon,
  Alert,
  Badge,
  Button,
  Card,
  Group,
  Modal,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Tabs,
  Text,
  TextInput,
  Tooltip,
} from '@mantine/core';
import { DateInput } from '@mantine/dates';
import { useDisclosure } from '@mantine/hooks';
import {
  IconArrowBackUp,
  IconBook,
  IconCash,
  IconChartPie,
  IconPlus,
  IconScale,
  IconSearch,
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
import { date, dateTime, money, num } from '../utils/format';

const TYPE_COLORS = {
  ASSET: 'blue',
  LIABILITY: 'orange',
  EQUITY: 'grape',
  INCOME: 'teal',
  EXPENSE: 'red',
};

const blankJeLine = () => ({
  __key: Math.random().toString(36).slice(2),
  code: '',
  debit: 0,
  credit: 0,
  description: '',
});

export default function AccountsPage() {
  const qc = useQueryClient();
  const { can } = useAuth();
  const [search, setSearch] = useState('');
  const [ledgerAccount, setLedgerAccount] = useState(null);
  const [jeOpen, jeHandlers] = useDisclosure(false);
  const [jeLines, setJeLines] = useState([blankJeLine(), blankJeLine()]);
  const [jeHeader, setJeHeader] = useState({ narration: '', date: new Date() });
  const [posting, setPosting] = useState(false);

  const { data: accounts, isLoading } = useQuery({
    queryKey: ['accounts'],
    queryFn: async () => (await api.get('/accounts')).data.data,
  });

  const { data: journals } = useQuery({
    queryKey: ['journals'],
    queryFn: async () => (await api.get('/journals', { params: { limit: 200 } })).data.data,
  });

  const { data: tb } = useQuery({
    queryKey: ['trial-balance'],
    queryFn: async () => (await api.get('/gl/trial-balance')).data,
  });

  const { data: financials } = useQuery({
    queryKey: ['financials'],
    queryFn: async () => (await api.get('/gl/financials')).data.data,
  });

  const { data: ledger } = useQuery({
    queryKey: ['ledger', ledgerAccount],
    queryFn: async () => (await api.get('/accounts/' + ledgerAccount + '/ledger')).data,
    enabled: !!ledgerAccount,
  });

  const accountOptions = useMemo(
    () => (accounts || []).map((a) => ({ value: a.code, label: a.code + ' - ' + a.name })),
    [accounts]
  );

  const grouped = useMemo(() => {
    const g = {};
    (accounts || [])
      .filter((a) => {
        if (!search.trim()) return true;
        const q = search.toLowerCase();
        return a.name.toLowerCase().includes(q) || a.code.includes(q);
      })
      .forEach((a) => {
        g[a.type] = g[a.type] || [];
        g[a.type].push(a);
      });
    return g;
  }, [accounts, search]);

  const jeColumns = useMemo(
    () => [
      {
        key: 'code',
        title: 'Account',
        width: 260,
        type: 'select',
        options: accountOptions,
        required: true,
        validate: (v) => (!v ? 'Choose an account' : null),
      },
      { key: 'description', title: 'Description', width: 240 },
      { key: 'debit', title: 'Debit', width: 130, type: 'number', align: 'right', min: 0, total: true },
      { key: 'credit', title: 'Credit', width: 130, type: 'number', align: 'right', min: 0, total: true },
    ],
    [accountOptions]
  );

  const jeTotals = useMemo(() => {
    const dr = jeLines.reduce((s, l) => s + (Number(l.debit) || 0), 0);
    const cr = jeLines.reduce((s, l) => s + (Number(l.credit) || 0), 0);
    return { dr, cr, diff: dr - cr, balanced: Math.abs(dr - cr) < 0.01 && dr > 0 };
  }, [jeLines]);

  const postJournal = async () => {
    setPosting(true);
    try {
      const payload = {
        date: jeHeader.date,
        narration: jeHeader.narration,
        lines: jeLines
          .filter((l) => l.code && (Number(l.debit) || Number(l.credit)))
          .map((l) => ({
            code: l.code,
            debit: Number(l.debit) || 0,
            credit: Number(l.credit) || 0,
            description: l.description || '',
          })),
      };
      const res = await api.post('/journals', payload);
      showSuccess(res.data.data.code + ' posted');
      qc.invalidateQueries({ queryKey: ['journals'] });
      qc.invalidateQueries({ queryKey: ['trial-balance'] });
      qc.invalidateQueries({ queryKey: ['financials'] });
      jeHandlers.close();
      setJeLines([blankJeLine(), blankJeLine()]);
      setJeHeader({ narration: '', date: new Date() });
    } catch (e) {
      showError(e, 'Could not post the entry');
    } finally {
      setPosting(false);
    }
  };

  const reverse = async (id, code) => {
    try {
      const res = await api.post('/journals/' + id + '/reverse');
      showSuccess(res.data.message);
      qc.invalidateQueries({ queryKey: ['journals'] });
      qc.invalidateQueries({ queryKey: ['trial-balance'] });
    } catch (e) {
      showError(e, 'Could not reverse ' + code);
    }
  };

  if (isLoading) return <Loading label="Loading the general ledger" />;

  return (
    <PageTransition>
      <PageHeader
        icon={IconCash}
        title="Accounts / General ledger"
        subtitle="Every production issue, completion, purchase and sale writes a balanced double-entry automatically. Manual entries are available for adjustments."
        actions={
          <Group gap="xs">
            <ExportMenu reportKey="trial-balance" label="Trial balance" />
            {can('gl.post') && (
              <Button leftSection={<IconPlus size={16} />} onClick={jeHandlers.open}>
                Manual entry
              </Button>
            )}
          </Group>
        }
      />

      {financials && (
        <SimpleGrid cols={{ base: 2, md: 5 }} spacing="md" mb="md">
          <StatCard label="Revenue" value={money(financials.revenue, 0)} compact color="teal" />
          <StatCard label="Cost of goods sold" value={money(financials.cogs, 0)} compact />
          <StatCard label="Gross profit" value={money(financials.grossProfit, 0)} compact color="teal" />
          <StatCard label="Total expenses" value={money(financials.totalExpenses, 0)} compact color="orange" />
          <StatCard
            label="Net profit"
            value={money(financials.netProfit, 0)}
            compact
            color={financials.netProfit >= 0 ? 'teal' : 'red'}
          />
        </SimpleGrid>
      )}

      {tb && (
        <Alert
          color={tb.summary.balanced ? 'teal' : 'red'}
          variant="light"
          icon={<IconScale size={18} />}
          mb="md"
        >
          Trial balance: debits {money(tb.summary.totalDebit, 2)} against credits {money(tb.summary.totalCredit, 2)}{' '}
          — <b>{tb.summary.balanced ? 'in balance' : 'OUT OF BALANCE'}</b>.
        </Alert>
      )}

      <Tabs defaultValue="journals" keepMounted={false}>
        <Tabs.List mb="md">
          <Tabs.Tab value="journals" leftSection={<IconBook size={16} />}>
            Journal entries
          </Tabs.Tab>
          <Tabs.Tab value="trial" leftSection={<IconScale size={16} />}>
            Trial balance
          </Tabs.Tab>
          <Tabs.Tab value="chart" leftSection={<IconChartPie size={16} />}>
            Chart of accounts
          </Tabs.Tab>
          <Tabs.Tab value="ledger" leftSection={<IconBook size={16} />}>
            Account ledger
          </Tabs.Tab>
        </Tabs.List>

        {/* ------------------------------ journals --------------------------- */}
        <Tabs.Panel value="journals">
          <Section title="Posted entries" description="Newest first. System entries are generated by the workflow.">
            <Accordion variant="separated" radius="md">
              {(journals || []).map((je) => (
                <Accordion.Item key={je._id} value={je._id}>
                  <Accordion.Control>
                    <Group justify="space-between" wrap="nowrap" pr="md">
                      <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
                        <Text ff="monospace" fw={700} size="sm">
                          {je.code}
                        </Text>
                        <Text size="sm" truncate style={{ minWidth: 0 }}>
                          {je.narration}
                        </Text>
                      </Group>
                      <Group gap="xs" wrap="nowrap">
                        {je.isSystemGenerated && (
                          <Badge size="xs" variant="light" color="blue">
                            auto
                          </Badge>
                        )}
                        <StatusBadge status={je.status} />
                        <Text size="xs" ff="monospace" fw={600}>
                          {money(je.totalDebit, 2)}
                        </Text>
                        <Text size="xs" c="dimmed">
                          {date(je.date)}
                        </Text>
                      </Group>
                    </Group>
                  </Accordion.Control>
                  <Accordion.Panel>
                    <Table fz="xs">
                      <Table.Thead>
                        <Table.Tr>
                          <Table.Th>Account</Table.Th>
                          <Table.Th>Description</Table.Th>
                          <Table.Th ta="right">Debit</Table.Th>
                          <Table.Th ta="right">Credit</Table.Th>
                        </Table.Tr>
                      </Table.Thead>
                      <Table.Tbody>
                        {je.lines.map((l, i) => (
                          <Table.Tr key={i}>
                            <Table.Td>
                              <Text size="xs" ff="monospace" fw={600}>
                                {l.accountCode}
                              </Text>
                              <Text size="10px" c="dimmed">
                                {l.accountName}
                              </Text>
                            </Table.Td>
                            <Table.Td>
                              <Text size="10px" c="dimmed">
                                {l.description}
                              </Text>
                            </Table.Td>
                            <Table.Td ta="right" ff="monospace">
                              {l.debit ? num(l.debit, 2) : ''}
                            </Table.Td>
                            <Table.Td ta="right" ff="monospace">
                              {l.credit ? num(l.credit, 2) : ''}
                            </Table.Td>
                          </Table.Tr>
                        ))}
                      </Table.Tbody>
                    </Table>
                    <Group justify="space-between" mt="sm">
                      <Text size="xs" c="dimmed">
                        {je.refType} {je.refCode} · {dateTime(je.createdAt)} · {je.createdBy?.name || 'system'}
                      </Text>
                      {can('gl.post') && je.status === 'POSTED' && (
                        <Button
                          size="compact-xs"
                          variant="light"
                          color="orange"
                          leftSection={<IconArrowBackUp size={14} />}
                          onClick={() => reverse(je._id, je.code)}
                        >
                          Reverse
                        </Button>
                      )}
                    </Group>
                  </Accordion.Panel>
                </Accordion.Item>
              ))}
            </Accordion>
          </Section>
        </Tabs.Panel>

        {/* --------------------------- trial balance ------------------------- */}
        <Tabs.Panel value="trial">
          <Section title="Trial balance">
            <Table.ScrollContainer minWidth={720}>
              <Table highlightOnHover>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Code</Table.Th>
                    <Table.Th>Account</Table.Th>
                    <Table.Th>Type</Table.Th>
                    <Table.Th ta="right">Total debit</Table.Th>
                    <Table.Th ta="right">Total credit</Table.Th>
                    <Table.Th ta="right">Balance Dr</Table.Th>
                    <Table.Th ta="right">Balance Cr</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {(tb?.data || []).map((r) => (
                    <Table.Tr
                      key={r.code}
                      style={{ cursor: 'pointer' }}
                      onClick={() => setLedgerAccount(r.accountId)}
                    >
                      <Table.Td ff="monospace" fw={600}>
                        {r.code}
                      </Table.Td>
                      <Table.Td>{r.name}</Table.Td>
                      <Table.Td>
                        <Badge size="xs" variant="light" color={TYPE_COLORS[r.type]}>
                          {r.type}
                        </Badge>
                      </Table.Td>
                      <Table.Td ta="right" ff="monospace">
                        {num(r.debit, 2)}
                      </Table.Td>
                      <Table.Td ta="right" ff="monospace">
                        {num(r.credit, 2)}
                      </Table.Td>
                      <Table.Td ta="right" ff="monospace" fw={600}>
                        {r.balanceDebit ? num(r.balanceDebit, 2) : ''}
                      </Table.Td>
                      <Table.Td ta="right" ff="monospace" fw={600}>
                        {r.balanceCredit ? num(r.balanceCredit, 2) : ''}
                      </Table.Td>
                    </Table.Tr>
                  ))}
                  <Table.Tr style={{ fontWeight: 800 }}>
                    <Table.Td colSpan={5}>TOTAL</Table.Td>
                    <Table.Td ta="right" ff="monospace">
                      {num(tb?.summary.totalDebit, 2)}
                    </Table.Td>
                    <Table.Td ta="right" ff="monospace">
                      {num(tb?.summary.totalCredit, 2)}
                    </Table.Td>
                  </Table.Tr>
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          </Section>
        </Tabs.Panel>

        {/* ---------------------------- chart -------------------------------- */}
        <Tabs.Panel value="chart">
          <Card mb="md" p="sm">
            <TextInput
              placeholder="Search account name or code"
              leftSection={<IconSearch size={15} />}
              value={search}
              onChange={(e) => setSearch(e.currentTarget.value)}
            />
          </Card>
          {Object.entries(grouped).map(([type, list]) => (
            <Section key={type} title={type} description={list.length + ' accounts'}>
              <Table fz="sm">
                <Table.Tbody>
                  {list.map((a) => (
                    <Table.Tr key={a._id} style={{ cursor: 'pointer' }} onClick={() => setLedgerAccount(a._id)}>
                      <Table.Td w={90} ff="monospace" fw={600}>
                        {a.code}
                      </Table.Td>
                      <Table.Td>{a.name}</Table.Td>
                      <Table.Td w={160}>
                        <Text size="xs" c="dimmed">
                          {a.subType}
                        </Text>
                      </Table.Td>
                      <Table.Td w={90}>
                        <Badge size="xs" variant="outline" color="gray">
                          {a.normalBalance}
                        </Badge>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Section>
          ))}
        </Tabs.Panel>

        {/* ---------------------------- ledger ------------------------------- */}
        <Tabs.Panel value="ledger">
          <Card mb="md" p="sm">
            <Group>
              <Select
                label="Account"
                placeholder="Choose an account"
                data={(accounts || []).map((a) => ({ value: a._id, label: a.code + ' - ' + a.name }))}
                value={ledgerAccount}
                onChange={setLedgerAccount}
                searchable
                style={{ flex: 1 }}
              />
              {ledgerAccount && <ExportMenu reportKey="ledger" params={{ account: ledgerAccount }} label="Export ledger" />}
            </Group>
          </Card>

          {!ledgerAccount ? (
            <EmptyState title="Pick an account" description="Choose an account to see its ledger with a running balance." icon={IconBook} />
          ) : (
            <Section
              title={ledger?.account ? ledger.account.code + ' — ' + ledger.account.name : 'Ledger'}
              description={'Closing balance ' + money(ledger?.closingBalance || 0, 2)}
            >
              <Table.ScrollContainer minWidth={780}>
                <Table highlightOnHover fz="xs">
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Date</Table.Th>
                      <Table.Th>Entry</Table.Th>
                      <Table.Th>Reference</Table.Th>
                      <Table.Th>Narration</Table.Th>
                      <Table.Th ta="right">Debit</Table.Th>
                      <Table.Th ta="right">Credit</Table.Th>
                      <Table.Th ta="right">Balance</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {(ledger?.data || []).map((r, i) => (
                      <Table.Tr key={i}>
                        <Table.Td>{date(r.date)}</Table.Td>
                        <Table.Td ff="monospace">{r.entryCode}</Table.Td>
                        <Table.Td ff="monospace" c="dimmed">
                          {r.refCode}
                        </Table.Td>
                        <Table.Td>{r.narration}</Table.Td>
                        <Table.Td ta="right" ff="monospace">
                          {r.debit ? num(r.debit, 2) : ''}
                        </Table.Td>
                        <Table.Td ta="right" ff="monospace">
                          {r.credit ? num(r.credit, 2) : ''}
                        </Table.Td>
                        <Table.Td ta="right" ff="monospace" fw={600}>
                          {num(r.balance, 2)}
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            </Section>
          )}
        </Tabs.Panel>
      </Tabs>

      {/* ------------------------- manual journal modal ---------------------- */}
      <Modal opened={jeOpen} onClose={jeHandlers.close} title="Manual journal entry" size="80%">
        <Stack>
          <SimpleGrid cols={{ base: 1, xs: 2 }}>
            <TextInput
              label="Narration"
              required
              placeholder="Depreciation for the month"
              value={jeHeader.narration}
              onChange={(e) => setJeHeader({ ...jeHeader, narration: e.currentTarget.value })}
            />
            <DateInput
              label="Date"
              value={jeHeader.date}
              onChange={(v) => setJeHeader({ ...jeHeader, date: v })}
            />
          </SimpleGrid>

          <ExcelGrid columns={jeColumns} rows={jeLines} onChange={setJeLines} emptyRow={blankJeLine} minRows={2} />

          <Group justify="space-between">
            <Group gap="lg">
              <Text size="sm">
                Debits <b>{money(jeTotals.dr, 2)}</b>
              </Text>
              <Text size="sm">
                Credits <b>{money(jeTotals.cr, 2)}</b>
              </Text>
              <Badge color={jeTotals.balanced ? 'teal' : 'red'} variant="light">
                {jeTotals.balanced ? 'Balanced' : 'Difference ' + money(jeTotals.diff, 2)}
              </Badge>
            </Group>
            <Group>
              <Button variant="default" onClick={jeHandlers.close}>
                Cancel
              </Button>
              <Button
                loading={posting}
                disabled={!jeTotals.balanced || !jeHeader.narration.trim()}
                onClick={postJournal}
              >
                Post entry
              </Button>
            </Group>
          </Group>
        </Stack>
      </Modal>
    </PageTransition>
  );
}
