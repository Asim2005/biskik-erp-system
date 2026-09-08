import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  Alert,
  Badge,
  Card,
  Grid,
  Group,
  Progress,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Title,
} from '@mantine/core';
import { AreaChart, DonutChart } from '@mantine/charts';
import {
  IconAlertTriangle,
  IconBuildingFactory2,
  IconCash,
  IconChefHat,
  IconLayoutDashboard,
  IconPackages,
  IconReceiptTax,
  IconTrendingUp,
} from '@tabler/icons-react';
import { api } from '../api/client';
import {
  EmptyState,
  Loading,
  Money,
  PageHeader,
  PageTransition,
  Section,
  Stagger,
  StaggerItem,
  StatCard,
  StatusBadge,
  VarianceText,
} from '../components/ui';
import { date, int, money, moneyShort, num, periodLabel } from '../utils/format';

const CATEGORY_COLORS = {
  RAW: 'biscuit.6',
  PACKAGING: 'cocoa.5',
  CONSUMABLE: 'slate.5',
  FINISHED: 'teal.6',
  WIP: 'indigo.5',
};

export default function DashboardPage() {
  const navigate = useNavigate();
  const { data, isLoading, error } = useQuery({
    queryKey: ['dashboard'],
    queryFn: async () => (await api.get('/dashboard')).data.data,
  });

  if (isLoading) return <Loading label="Building the dashboard" />;
  if (error) return <EmptyState title="Could not load the dashboard" description={error.friendly} />;

  const c = data.cards;

  const donut = Object.entries(data.stockByCategory || {}).map(([name, value]) => ({
    name,
    value: Math.round(value),
    color: CATEGORY_COLORS[name] || 'gray.5',
  }));

  const trend = (data.trend || []).map((t) => ({
    order: t.code,
    Standard: t.standardUnitCost,
    Actual: t.actualUnitCost,
  }));

  return (
    <PageTransition>
      <PageHeader
        icon={IconLayoutDashboard}
        title="Manufacturing dashboard"
        subtitle={
          'Recipe → production → inventory → costing → accounts → tax, all driven by live postings. Period ' +
          periodLabel(data.period) +
          '.'
        }
        badge={<Badge variant="light" color="teal">Live</Badge>}
      />

      {/* ------------------------------- tiles -------------------------------- */}
      <Stagger>
        <SimpleGrid cols={{ base: 1, xs: 2, md: 3, lg: 5 }} spacing="md" mb="md">
          <StaggerItem>
            <StatCard
              label="Active recipes"
              value={c.activeRecipes}
              sub={c.pendingApprovals + ' awaiting approval'}
              icon={IconChefHat}
            />
          </StaggerItem>
          <StaggerItem>
            <StatCard
              label="Produced this month"
              value={int(c.producedThisMonth) + ' pcs'}
              sub={c.openOrders + ' open orders'}
              icon={IconBuildingFactory2}
              color="cocoa"
            />
          </StaggerItem>
          <StaggerItem>
            <StatCard
              label="Actual cost / biscuit"
              value={c.avgActualUnitCost ? money(c.avgActualUnitCost, 4) : '-'}
              sub={'Standard ' + money(c.avgStandardUnitCost, 4)}
              icon={IconTrendingUp}
              trend={c.unitCostVariance}
              color="grape"
            />
          </StaggerItem>
          <StaggerItem>
            <StatCard
              label="Inventory value"
              value={moneyShort(c.inventoryValue)}
              sub="RM + packaging + finished goods"
              icon={IconPackages}
              color="teal"
            />
          </StaggerItem>
          <StaggerItem>
            <StatCard
              label="Net sales tax"
              value={moneyShort(c.netTaxPayable)}
              sub={'Output − input for ' + data.period}
              icon={IconReceiptTax}
              color="orange"
            />
          </StaggerItem>
        </SimpleGrid>
      </Stagger>

      {/* --------------------------- money summary ---------------------------- */}
      <SimpleGrid cols={{ base: 1, xs: 3 }} spacing="md" mb="md">
        <StatCard label="Revenue to date" value={moneyShort(c.revenue)} icon={IconCash} color="blue" compact />
        <StatCard label="Gross profit" value={moneyShort(c.grossProfit)} sub={c.revenue ? num((c.grossProfit / c.revenue) * 100, 1) + '% margin' : ''} color="teal" compact />
        <StatCard label="Net profit" value={moneyShort(c.netProfit)} sub="After admin and marketing" color={c.netProfit >= 0 ? 'teal' : 'red'} compact />
      </SimpleGrid>

      <Grid gutter="md">
        {/* ---------------------------- cost trend --------------------------- */}
        <Grid.Col span={{ base: 12, lg: 8 }}>
          <Section
            title="Unit cost: standard vs actual"
            description="Every completed order, oldest first. A widening gap means the shop floor is drifting from the approved formula."
          >
            {trend.length ? (
              <AreaChart
                h={260}
                data={trend}
                dataKey="order"
                withLegend
                curveType="monotone"
                valueFormatter={(v) => money(v, 4)}
                series={[
                  { name: 'Standard', color: 'slate.5' },
                  { name: 'Actual', color: 'biscuit.6' },
                ]}
              />
            ) : (
              <Text c="dimmed" size="sm" py="xl" ta="center">
                Complete a production order to see the trend.
              </Text>
            )}
          </Section>

          <Section title="Recent production orders" description="Click a row to open the full variance analysis.">
            {data.recentOrders?.length ? (
              <Table.ScrollContainer minWidth={640}>
                <Table>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Order</Table.Th>
                      <Table.Th>Product</Table.Th>
                      <Table.Th>Status</Table.Th>
                      <Table.Th ta="right">Planned</Table.Th>
                      <Table.Th ta="right">Good</Table.Th>
                      <Table.Th ta="right">Variance</Table.Th>
                      <Table.Th>Created</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {data.recentOrders.map((o) => (
                      <Table.Tr key={o.code} style={{ cursor: 'pointer' }}>
                        <Table.Td>
                          <Text size="sm" fw={700} ff="monospace">
                            {o.code}
                          </Text>
                        </Table.Td>
                        <Table.Td>{o.productName}</Table.Td>
                        <Table.Td>
                          <StatusBadge status={o.status} />
                        </Table.Td>
                        <Table.Td ta="right">{int(o.plannedQty)}</Table.Td>
                        <Table.Td ta="right">{int(o.goodQty)}</Table.Td>
                        <Table.Td ta="right">
                          {/*
                            Only a finished order has a variance. A released
                            order has a standard cost and no actual yet, so
                            this reported the whole standard as a favourable
                            saving - a large green number for work that has
                            not happened. The production list already draws
                            this distinction.
                          */}
                          {o.status === 'COMPLETED' ? (
                            <VarianceText value={o.totalVariance} />
                          ) : (
                            <Text size="xs" c="dimmed">
                              -
                            </Text>
                          )}
                        </Table.Td>
                        <Table.Td>
                          <Text size="xs" c="dimmed">
                            {date(o.createdAt)}
                          </Text>
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            ) : (
              <Text c="dimmed" size="sm">
                No production orders yet.
              </Text>
            )}
          </Section>
        </Grid.Col>

        {/* ------------------------------ side ------------------------------- */}
        <Grid.Col span={{ base: 12, lg: 4 }}>
          <Section title="Inventory mix" description="Value on hand by category">
            {donut.length ? (
              <>
                <Group justify="center">
                  <DonutChart
                    data={donut}
                    size={172}
                    thickness={26}
                    withTooltip
                    tooltipDataSource="segment"
                    valueFormatter={(v) => money(v, 0)}
                    chartLabel={moneyShort(c.inventoryValue)}
                  />
                </Group>
                <Stack gap={6} mt="md">
                  {donut.map((d) => (
                    <Group key={d.name} justify="space-between">
                      <Group gap={8}>
                        <div
                          style={{
                            width: 9,
                            height: 9,
                            borderRadius: 3,
                            background: 'var(--mantine-color-' + d.color.replace('.', '-') + ')',
                          }}
                        />
                        <Text size="xs">{d.name}</Text>
                      </Group>
                      <Money value={d.value} short size="xs" fw={600} />
                    </Group>
                  ))}
                </Stack>
              </>
            ) : (
              <Text c="dimmed" size="sm">
                No stock on hand.
              </Text>
            )}
          </Section>

          <Section title="Workflow status">
            <Stack gap="sm">
              {data.workflow.map((w) => (
                <Group key={w.stage} justify="space-between">
                  <Text size="sm">{w.stage}</Text>
                  <Badge
                    variant="light"
                    color={w.tone === 'warn' ? 'orange' : w.tone === 'ok' ? 'teal' : 'blue'}
                  >
                    {w.status}
                  </Badge>
                </Group>
              ))}
            </Stack>
          </Section>

          <Section title="Stock alerts" description="At or below the reorder level">
            {data.lowStock?.length ? (
              <Stack gap="sm">
                {data.lowStock.map((s) => {
                  const ratio = s.reorderLevel ? Math.min(100, (s.onHand / s.reorderLevel) * 100) : 0;
                  return (
                    <div key={s.code}>
                      <Group justify="space-between" mb={4}>
                        <Text size="xs" fw={600}>
                          {s.name}
                        </Text>
                        <Text size="10px" c="dimmed" ff="monospace">
                          {num(s.onHand, 1)} / {num(s.reorderLevel, 0)} {s.uom}
                        </Text>
                      </Group>
                      <Progress value={ratio} color={ratio < 50 ? 'red' : 'orange'} size="sm" radius="xl" />
                    </div>
                  );
                })}
              </Stack>
            ) : (
              <Alert color="teal" variant="light" py="xs">
                Every material is above its reorder level.
              </Alert>
            )}
          </Section>

          {c.pendingApprovals > 0 && (
            <Alert
              color="orange"
              variant="light"
              icon={<IconAlertTriangle size={18} />}
              title="Recipes waiting"
              style={{ cursor: 'pointer' }}
              onClick={() => navigate('/recipes')}
            >
              {c.pendingApprovals} recipe version{c.pendingApprovals === 1 ? ' needs' : 's need'} an authorised approval
              before they can be used in production.
            </Alert>
          )}
        </Grid.Col>
      </Grid>
    </PageTransition>
  );
}
