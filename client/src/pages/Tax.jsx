import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  Badge,
  Card,
  Grid,
  Group,
  SimpleGrid,
  Stack,
  Table,
  Tabs,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { BarChart } from '@mantine/charts';
import { IconAlertTriangle, IconInfoCircle, IconReceiptTax, IconTable } from '@tabler/icons-react';
import { api } from '../api/client';
import {
  EmptyState,
  ExportMenu,
  Loading,
  PageHeader,
  PageTransition,
  Section,
  StatCard,
} from '../components/ui';
import { currentPeriod, date, money, num, periodLabel } from '../utils/format';

export default function TaxPage() {
  const [period, setPeriod] = useState(currentPeriod());

  const { data, isLoading } = useQuery({
    queryKey: ['tax', period],
    queryFn: async () => (await api.get('/tax/summary', { params: { period } })).data,
  });

  const { data: register } = useQuery({
    queryKey: ['tax-register', period],
    queryFn: async () => (await api.get('/tax/register', { params: { period } })).data.data,
  });

  if (isLoading) return <Loading label="Computing the tax position" />;

  const s = data.data;
  const ledger = data.ledger || [];
  const config = data.config || {};

  const chart = ledger.map((l) => ({
    period: periodLabel(l.period).slice(0, 3) + ' ' + l.period.slice(2, 4),
    Input: l.inputTax,
    Output: l.outputTax,
  }));

  return (
    <PageTransition>
      <PageHeader
        icon={IconReceiptTax}
        title="Sales tax"
        subtitle="Input tax on purchases is recoverable and never capitalised into inventory. Output tax on sales is a liability and is kept out of revenue."
        actions={
          <Group gap="xs">
            <TextInput
              label=""
              placeholder="YYYY-MM"
              value={period}
              onChange={(e) => setPeriod(e.currentTarget.value)}
              w={130}
            />
            <ExportMenu reportKey="sales-tax" params={{ period }} label="Summary" />
            <ExportMenu reportKey="tax-register" params={{ period }} label="Register" />
          </Group>
        }
      />

      <Alert color="orange" variant="light" icon={<IconAlertTriangle size={18} />} mb="md">
        The {config.defaultSalesTaxRate}% rate configured here is illustrative. Set the rate, exemptions and any
        further tax that actually apply to your product under current law before filing anything from this system.
      </Alert>

      <SimpleGrid cols={{ base: 2, md: 5 }} spacing="md" mb="md">
        <StatCard label="Input tax" value={money(s.inputTax, 0)} sub={s.purchaseInvoiceCount + ' purchase invoices'} compact color="blue" />
        <StatCard label="Output tax" value={money(s.outputTax, 0)} sub={s.salesInvoiceCount + ' sales invoices'} compact color="orange" />
        <StatCard label="Taxable sales" value={money(s.taxableSales, 0)} compact color="teal" />
        <StatCard label="Taxable purchases" value={money(s.taxablePurchases, 0)} compact />
        <StatCard
          label={s.net >= 0 ? 'Net payable' : 'Refundable'}
          value={money(Math.abs(s.net), 0)}
          sub={periodLabel(period)}
          compact
          color={s.net > 0 ? 'red' : 'teal'}
        />
      </SimpleGrid>

      <Grid gutter="md">
        <Grid.Col span={{ base: 12, lg: 7 }}>
          <Section title="Input against output by period">
            {chart.length ? (
              <BarChart
                h={250}
                data={chart}
                dataKey="period"
                withLegend
                valueFormatter={(v) => money(v, 0)}
                series={[
                  { name: 'Input', color: 'blue.5' },
                  { name: 'Output', color: 'orange.6' },
                ]}
              />
            ) : (
              <Text c="dimmed" size="sm" py="lg" ta="center">
                Post an invoice to build the tax ledger.
              </Text>
            )}
          </Section>

          <Section title="Period ledger">
            <Table.ScrollContainer minWidth={700}>
              <Table highlightOnHover>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Period</Table.Th>
                    <Table.Th ta="right">Invoices</Table.Th>
                    <Table.Th ta="right">Taxable purchases</Table.Th>
                    <Table.Th ta="right">Input tax</Table.Th>
                    <Table.Th ta="right">Taxable sales</Table.Th>
                    <Table.Th ta="right">Output tax</Table.Th>
                    <Table.Th ta="right">Net</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {ledger.map((l) => (
                    <Table.Tr key={l.period} bg={l.period === period ? 'var(--mantine-color-default-hover)' : undefined}>
                      <Table.Td fw={600}>{periodLabel(l.period)}</Table.Td>
                      <Table.Td ta="right">{l.invoices}</Table.Td>
                      <Table.Td ta="right" ff="monospace">
                        {num(l.taxablePurchases, 0)}
                      </Table.Td>
                      <Table.Td ta="right" ff="monospace" c="blue.7">
                        {num(l.inputTax, 2)}
                      </Table.Td>
                      <Table.Td ta="right" ff="monospace">
                        {num(l.taxableSales, 0)}
                      </Table.Td>
                      <Table.Td ta="right" ff="monospace" c="orange.7">
                        {num(l.outputTax, 2)}
                      </Table.Td>
                      <Table.Td ta="right" ff="monospace" fw={700}>
                        {num(l.net, 2)}
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          </Section>
        </Grid.Col>

        <Grid.Col span={{ base: 12, lg: 5 }}>
          <Section title={'Position for ' + periodLabel(period)}>
            <Stack gap="sm">
              <Row label="Output tax on sales" value={money(s.outputTax, 2)} />
              <Row label="Less: input tax on purchases" value={'(' + money(s.inputTax, 2) + ')'} />
              <Row label="Adjustments" value={money(s.adjustments, 2)} dim />
              <div style={{ height: 1, background: 'var(--mantine-color-default-border)' }} />
              <Group justify="space-between">
                <Text fw={800}>{s.net >= 0 ? 'Net payable' : 'Refundable'}</Text>
                <Badge size="lg" variant="light" color={s.net > 0 ? 'red' : 'teal'}>
                  {money(Math.abs(s.net), 2)}
                </Badge>
              </Group>
            </Stack>

            <Alert mt="md" color="blue" variant="light" icon={<IconInfoCircle size={16} />} p="xs">
              <Text size="xs">
                These figures come straight from posted invoices, and the output tax total equals the balance on the
                Output Sales Tax Payable account in the ledger.
              </Text>
            </Alert>
          </Section>

          <Section title="Configured rates" description="Change these in Settings">
            <Stack gap="xs">
              <Row label="Standard sales tax" value={config.defaultSalesTaxRate + '%'} />
              <Row label="Further tax (unregistered)" value={config.furtherTaxRate + '%'} />
              <Row label="Withholding tax" value={config.withholdingTaxRate + '%'} />
            </Stack>
          </Section>
        </Grid.Col>
      </Grid>

      <Section
        title="Invoice register"
        description={'Every posted invoice in ' + periodLabel(period) + ' with its tax detail.'}
      >
        {register?.length ? (
          <Table.ScrollContainer minWidth={900}>
            <Table highlightOnHover fz="xs">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Date</Table.Th>
                  <Table.Th>Invoice</Table.Th>
                  <Table.Th>Type</Table.Th>
                  <Table.Th>Party</Table.Th>
                  <Table.Th>NTN</Table.Th>
                  <Table.Th ta="right">Taxable value</Table.Th>
                  <Table.Th ta="right">Rate</Table.Th>
                  <Table.Th ta="right">Input tax</Table.Th>
                  <Table.Th ta="right">Output tax</Table.Th>
                  <Table.Th ta="right">Total</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {register.map((r) => (
                  <Table.Tr key={r.code}>
                    <Table.Td>{date(r.date)}</Table.Td>
                    <Table.Td ff="monospace" fw={600}>
                      {r.code}
                    </Table.Td>
                    <Table.Td>
                      <Badge size="xs" variant="light" color={r.kind === 'SALES' ? 'orange' : 'blue'}>
                        {r.kind.toLowerCase()}
                      </Badge>
                    </Table.Td>
                    <Table.Td>{r.party}</Table.Td>
                    <Table.Td ff="monospace" c="dimmed">
                      {r.ntn || '-'}
                    </Table.Td>
                    <Table.Td ta="right" ff="monospace">
                      {num(r.taxable, 2)}
                    </Table.Td>
                    <Table.Td ta="right">{r.taxRate}%</Table.Td>
                    <Table.Td ta="right" ff="monospace" c="blue.7">
                      {r.inputTax ? num(r.inputTax, 2) : ''}
                    </Table.Td>
                    <Table.Td ta="right" ff="monospace" c="orange.7">
                      {r.outputTax ? num(r.outputTax, 2) : ''}
                    </Table.Td>
                    <Table.Td ta="right" ff="monospace" fw={600}>
                      {num(r.grandTotal, 2)}
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        ) : (
          <EmptyState
            title={'No posted invoices in ' + periodLabel(period)}
            description="Post a sales or purchase invoice to populate this register."
            icon={IconTable}
          />
        )}
      </Section>
    </PageTransition>
  );
}

function Row({ label, value, dim }) {
  return (
    <Group justify="space-between">
      <Text size="sm" c={dim ? 'dimmed' : undefined}>
        {label}
      </Text>
      <Text size="sm" ff="monospace" fw={600}>
        {value}
      </Text>
    </Group>
  );
}
