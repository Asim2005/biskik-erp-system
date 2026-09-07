import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  Alert,
  Badge,
  Card,
  Grid,
  Group,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Title,
} from '@mantine/core';
import { BarChart } from '@mantine/charts';
import { IconChartHistogram, IconInfoCircle } from '@tabler/icons-react';
import { api } from '../api/client';
import {
  EmptyState,
  ExportMenu,
  Loading,
  PageHeader,
  PageTransition,
  Section,
  StatCard,
  VarianceText,
} from '../components/ui';
import { int, money, num, pct } from '../utils/format';

export default function CostingPage() {
  const navigate = useNavigate();
  const [orderId, setOrderId] = useState(null);
  const [view, setView] = useState('MANUFACTURING');

  const { data: orders, isLoading } = useQuery({
    queryKey: ['production'],
    queryFn: async () => (await api.get('/production')).data.data,
  });

  const completed = useMemo(() => (orders || []).filter((o) => o.status === 'COMPLETED'), [orders]);
  const selectedId = orderId || completed[0]?._id;

  const { data: detail } = useQuery({
    queryKey: ['production', selectedId, 'variance'],
    queryFn: async () => (await api.get('/production/' + selectedId + '/variance')).data.data,
    enabled: !!selectedId,
  });

  const { data: recipeData } = useQuery({
    queryKey: ['recipe', detail?.order?.recipe],
    queryFn: async () => (await api.get('/recipes/' + detail.order.recipe)).data,
    enabled: !!detail?.order?.recipe,
  });

  if (isLoading) return <Loading label="Loading costing data" />;

  if (!completed.length) {
    return (
      <PageTransition>
        <PageHeader
          icon={IconChartHistogram}
          title="Product costing"
          subtitle="Manufacturing cost is kept separate from full management cost."
        />
        <EmptyState
          title="No completed production yet"
          description="Complete a production order and the estimated-vs-actual analysis appears here."
          icon={IconChartHistogram}
        />
      </PageTransition>
    );
  }

  const order = detail?.order;
  const analysis = detail?.analysis;
  const cost = recipeData?.cost;

  const units = order?.goodQty || order?.plannedQty || 1;

  // per-unit build-up, standard vs actual
  const elements = order
    ? [
        {
          element: 'Raw material',
          standard: order.standardMaterialCost / order.plannedQty,
          actual: order.actualMaterialCost / units,
        },
        {
          element: 'Direct labour',
          standard: order.standardLabourCost / order.plannedQty,
          actual: order.actualLabourCost / units,
        },
        {
          element: 'Factory overhead',
          standard: order.standardOverheadCost / order.plannedQty,
          actual: order.actualOverheadCost / units,
        },
      ]
    : [];

  const mfgStandard = elements.reduce((s, e) => s + e.standard, 0);
  const mfgActual = elements.reduce((s, e) => s + e.actual, 0);

  const adminRate = cost?.adminOverheadPerUnit || 0;
  const marketingRate = cost?.marketingOverheadPerUnit || 0;

  const fullRows = [
    ...elements,
    { element: 'Admin absorption', standard: adminRate, actual: adminRate, period: true },
    { element: 'Marketing absorption', standard: marketingRate, actual: marketingRate, period: true },
  ];

  const rows = view === 'MANUFACTURING' ? elements : fullRows;
  const totalStandard = view === 'MANUFACTURING' ? mfgStandard : mfgStandard + adminRate + marketingRate;
  const totalActual = view === 'MANUFACTURING' ? mfgActual : mfgActual + adminRate + marketingRate;

  const chart = rows.map((r) => ({
    element: r.element,
    Standard: Number(r.standard.toFixed(4)),
    Actual: Number(r.actual.toFixed(4)),
  }));

  return (
    <PageTransition>
      <PageHeader
        icon={IconChartHistogram}
        title="Product costing"
        subtitle="Manufacturing cost values inventory. Full management cost adds administration and marketing and is used for pricing, never for stock valuation."
        actions={
          <Group gap="xs">
            <Select
              data={completed.map((o) => ({
                value: o._id,
                label: o.code + ' — ' + o.productName + ' (' + int(o.goodQty) + ' units)',
              }))}
              value={selectedId}
              onChange={setOrderId}
              w={{ base: '100%', sm: 320 }}
            />
            <ExportMenu reportKey="production-variance" params={{ id: selectedId }} label="Cost sheet" />
          </Group>
        }
      />

      {order && (
        <>
          <SimpleGrid cols={{ base: 2, md: 5 }} spacing="md" mb="md">
            <StatCard label="Material / unit" value={money(elements[0].actual, 4)} sub={'Std ' + num(elements[0].standard, 4)} compact />
            <StatCard label="Labour / unit" value={money(elements[1].actual, 4)} sub={'Std ' + num(elements[1].standard, 4)} compact />
            <StatCard label="Overhead / unit" value={money(elements[2].actual, 4)} sub={'Std ' + num(elements[2].standard, 4)} compact />
            <StatCard
              label="Manufacturing cost"
              value={money(mfgActual, 4)}
              sub={'Std ' + num(mfgStandard, 4)}
              compact
              color="biscuit"
            />
            <StatCard
              label="Full management cost"
              value={money(mfgActual + adminRate + marketingRate, 4)}
              sub={'Std ' + num(mfgStandard + adminRate + marketingRate, 4)}
              compact
              color="grape"
            />
          </SimpleGrid>

          <Grid gutter="md">
            <Grid.Col span={{ base: 12, lg: 7 }}>
              <Section
                title="Cost build-up per unit"
                description="Standard comes from the approved recipe; actual comes from what was really consumed and spent."
                actions={
                  <SegmentedControl
                    size="xs"
                    value={view}
                    onChange={setView}
                    data={[
                      { label: 'Manufacturing', value: 'MANUFACTURING' },
                      { label: 'Full management', value: 'FULL' },
                    ]}
                  />
                }
              >
                <BarChart
                  h={240}
                  data={chart}
                  dataKey="element"
                  withLegend
                  valueFormatter={(v) => money(v, 4)}
                  series={[
                    { name: 'Standard', color: 'slate.5' },
                    { name: 'Actual', color: 'biscuit.6' },
                  ]}
                />

                <Table mt="md">
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Cost element</Table.Th>
                      <Table.Th ta="right">Standard / unit</Table.Th>
                      <Table.Th ta="right">Actual / unit</Table.Th>
                      <Table.Th ta="right">Variance</Table.Th>
                      <Table.Th ta="right">Variance %</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {rows.map((r) => (
                      <Table.Tr key={r.element}>
                        <Table.Td>
                          <Group gap={6}>
                            <Text size="sm">{r.element}</Text>
                            {r.period && (
                              <Badge size="xs" variant="light" color="grape">
                                period cost
                              </Badge>
                            )}
                          </Group>
                        </Table.Td>
                        <Table.Td ta="right" ff="monospace">
                          {num(r.standard, 4)}
                        </Table.Td>
                        <Table.Td ta="right" ff="monospace" fw={600}>
                          {num(r.actual, 4)}
                        </Table.Td>
                        <Table.Td ta="right">
                          <VarianceText value={r.actual - r.standard} dp={4} />
                        </Table.Td>
                        <Table.Td ta="right" c="dimmed" fz="xs">
                          {r.standard ? pct(((r.actual - r.standard) / r.standard) * 100, 2) : '-'}
                        </Table.Td>
                      </Table.Tr>
                    ))}
                    <Table.Tr style={{ fontWeight: 700 }}>
                      <Table.Td>
                        {view === 'MANUFACTURING' ? 'MANUFACTURING COST' : 'FULL MANAGEMENT COST'}
                      </Table.Td>
                      <Table.Td ta="right" ff="monospace">
                        {num(totalStandard, 4)}
                      </Table.Td>
                      <Table.Td ta="right" ff="monospace">
                        {num(totalActual, 4)}
                      </Table.Td>
                      <Table.Td ta="right">
                        <VarianceText value={totalActual - totalStandard} dp={4} />
                      </Table.Td>
                      <Table.Td ta="right" fz="xs">
                        {totalStandard
                          ? pct(((totalActual - totalStandard) / totalStandard) * 100, 2)
                          : '-'}
                      </Table.Td>
                    </Table.Tr>
                  </Table.Tbody>
                </Table>
              </Section>
            </Grid.Col>

            <Grid.Col span={{ base: 12, lg: 5 }}>
              <Section title="Where the variance came from">
                <Stack gap="sm">
                  <VarianceLine label="Material usage" value={analysis.materialUsageVariance} />
                  <VarianceLine label="Material price" value={analysis.materialPriceVariance} />
                  <VarianceLine label="Direct labour" value={analysis.labourVariance} />
                  <VarianceLine label="Factory overhead" value={analysis.overheadVariance} />
                  <div style={{ height: 1, background: 'var(--mantine-color-default-border)' }} />
                  <Group justify="space-between">
                    <Text fw={800} size="sm">
                      Total
                    </Text>
                    <VarianceText value={analysis.totalVariance} />
                  </Group>
                  <Group justify="space-between">
                    <Text size="xs" c="dimmed">
                      Yield loss ({int(analysis.yieldLossUnits)} units)
                    </Text>
                    <Text size="xs" ff="monospace">
                      {money(analysis.yieldVariance, 2)}
                    </Text>
                  </Group>
                </Stack>
              </Section>

              <Section title="Order">
                <Stack gap={6}>
                  <Line label="Order" value={order.code} />
                  <Line label="Product" value={order.productName} />
                  <Line label="Recipe" value={order.recipeCode + ' v' + order.recipeVersion} />
                  <Line label="Planned" value={int(order.plannedQty) + ' units'} />
                  <Line label="Good output" value={int(order.goodQty) + ' units'} />
                  <Line label="Yield" value={pct(analysis.yieldPercent)} />
                  <Line label="Total standard cost" value={money(order.standardTotalCost, 0)} />
                  <Line label="Total actual cost" value={money(order.actualTotalCost, 0)} />
                </Stack>
              </Section>

              <Alert color="blue" variant="light" icon={<IconInfoCircle size={18} />}>
                <Text size="xs">
                  Actual cost per unit is spread over <b>good output only</b>. The {int(analysis.yieldLossUnits)}{' '}
                  units that did not survive are charged to the yield loss account, which is why the actual unit
                  cost sits above the standard even when spending is on plan.
                </Text>
              </Alert>
            </Grid.Col>
          </Grid>
        </>
      )}
    </PageTransition>
  );
}

function VarianceLine({ label, value }) {
  return (
    <Group justify="space-between">
      <Text size="sm">{label}</Text>
      <VarianceText value={value} />
    </Group>
  );
}

function Line({ label, value }) {
  return (
    <Group justify="space-between" wrap="nowrap">
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      <Text size="xs" fw={600} ff="monospace">
        {value}
      </Text>
    </Group>
  );
}
