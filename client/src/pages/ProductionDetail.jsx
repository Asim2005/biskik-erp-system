import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Badge,
  Button,
  Card,
  Grid,
  Group,
  Modal,
  NumberInput,
  Progress,
  SimpleGrid,
  Stack,
  Table,
  Tabs,
  Text,
  Textarea,
  Title,
  Tooltip,
} from '@mantine/core';
import { BarChart } from '@mantine/charts';
import { useDisclosure } from '@mantine/hooks';
import {
  IconAlertTriangle,
  IconArrowLeft,
  IconBuildingFactory2,
  IconCheck,
  IconChecklist,
  IconCircleCheck,
  IconFileTypePdf,
  IconPackageExport,
  IconPlayerPlay,
  IconReceipt,
  IconScale,
  IconX,
} from '@tabler/icons-react';
import { api, downloadReport, showError, showSuccess } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { ExcelGrid } from '../components/ExcelGrid';
import {
  Loading,
  PageHeader,
  PageTransition,
  Section,
  StatCard,
  StatusBadge,
  VarianceText,
} from '../components/ui';
import { date, dateTime, int, money, num, pct } from '../utils/format';

export default function ProductionDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { can } = useAuth();

  const [issueRows, setIssueRows] = useState([]);
  const [issueOpen, issueHandlers] = useDisclosure(false);
  const [completeOpen, completeHandlers] = useDisclosure(false);
  const [busy, setBusy] = useState(false);
  const [completion, setCompletion] = useState({
    goodQty: 0,
    rejectQty: 0,
    actualLabourCost: 0,
    actualOverheadCost: 0,
    remarks: '',
  });

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['production', id],
    queryFn: async () => (await api.get('/production/' + id)).data,
  });

  const { data: varianceData } = useQuery({
    queryKey: ['production', id, 'variance'],
    queryFn: async () => (await api.get('/production/' + id + '/variance')).data.data,
    enabled: !!data,
  });

  const order = data?.data;

  useEffect(() => {
    if (!order) return;
    setIssueRows(
      order.lines.map((l) => ({
        __key: l.materialCode,
        materialCode: l.materialCode,
        materialName: l.materialName,
        uom: l.uom,
        standardQty: l.standardQty,
        standardRate: l.standardRate,
        actualQty: l.actualQty || l.standardQty,
      }))
    );
    setCompletion((c) => ({
      ...c,
      goodQty: order.goodQty || Math.round(order.plannedQty * 0.985),
      rejectQty: order.rejectQty || 0,
      actualLabourCost: order.actualLabourCost || order.standardLabourCost,
      actualOverheadCost: order.actualOverheadCost || order.standardOverheadCost,
    }));
  }, [order]);

  const issueColumns = useMemo(
    () => [
      { key: 'materialCode', title: 'Code', width: 90, editable: false },
      { key: 'materialName', title: 'Material', width: 210, editable: false },
      {
        key: 'standardQty',
        title: 'Standard qty',
        width: 120,
        type: 'number',
        align: 'right',
        precision: 3,
        editable: false,
        total: true,
      },
      {
        key: 'actualQty',
        title: 'Actual issued',
        width: 130,
        type: 'number',
        align: 'right',
        precision: 3,
        min: 0,
        required: true,
        total: true,
      },
      { key: 'uom', title: 'UOM', width: 60, editable: false, align: 'center' },
      {
        key: '__diff',
        title: 'Variance qty',
        width: 120,
        type: 'computed',
        align: 'right',
        precision: 3,
        compute: (r) => (Number(r.actualQty) || 0) - (Number(r.standardQty) || 0),
        format: (v) => (v > 0 ? '+' : '') + num(v, 3),
      },
      {
        key: '__pct',
        title: 'Variance %',
        width: 100,
        type: 'computed',
        align: 'right',
        compute: (r) =>
          r.standardQty ? (((Number(r.actualQty) || 0) - r.standardQty) / r.standardQty) * 100 : 0,
        format: (v) => (v > 0 ? '+' : '') + num(v, 2) + '%',
      },
      {
        key: '__cost',
        title: 'Est. value',
        width: 120,
        type: 'computed',
        align: 'right',
        precision: 2,
        total: true,
        compute: (r) => (Number(r.actualQty) || 0) * (Number(r.standardRate) || 0),
        format: (v) => num(v, 2),
      },
    ],
    []
  );

  const runAction = async (action, body) => {
    setBusy(true);
    try {
      const res = await api.post('/production/' + id + '/' + action, body || {});
      showSuccess(res.data.message || 'Posted');
      qc.invalidateQueries({ queryKey: ['production'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      qc.invalidateQueries({ queryKey: ['inventory'] });
      await refetch();
      issueHandlers.close();
      completeHandlers.close();
    } catch (e) {
      showError(e, 'Could not post that');
    } finally {
      setBusy(false);
    }
  };

  if (isLoading || !order) return <Loading label="Loading production order" />;

  const v = data.variance;
  const lines = varianceData?.lines || [];

  const chartData = [
    { element: 'Material', Standard: order.standardMaterialCost, Actual: order.actualMaterialCost },
    { element: 'Labour', Standard: order.standardLabourCost, Actual: order.actualLabourCost },
    { element: 'Overhead', Standard: order.standardOverheadCost, Actual: order.actualOverheadCost },
  ];

  return (
    <PageTransition>
      <PageHeader
        icon={IconBuildingFactory2}
        title={order.code}
        badge={<StatusBadge status={order.status} />}
        subtitle={
          order.productName +
          ' · recipe ' +
          order.recipeCode +
          ' v' +
          order.recipeVersion +
          ' · ' +
          int(order.plannedQty) +
          ' planned units on ' +
          order.lineNo
        }
        actions={
          <Group gap="xs">
            <Button variant="subtle" leftSection={<IconArrowLeft size={16} />} onClick={() => navigate('/production')}>
              Back
            </Button>
            <Button
              variant="default"
              leftSection={<IconFileTypePdf size={16} />}
              onClick={() =>
                downloadReport('production-variance', { format: 'pdf', params: { id } })
                  .then((n) => showSuccess(n + ' downloaded'))
                  .catch(showError)
              }
            >
              Variance PDF
            </Button>

            {order.status === 'DRAFT' && can('production.create') && (
              <Button leftSection={<IconPlayerPlay size={16} />} loading={busy} onClick={() => runAction('release')}>
                Release
              </Button>
            )}
            {['DRAFT', 'RELEASED'].includes(order.status) && can('production.issue') && (
              <Button leftSection={<IconPackageExport size={16} />} onClick={issueHandlers.open}>
                Issue materials
              </Button>
            )}
            {order.status === 'IN_PROGRESS' && can('production.complete') && (
              <Button color="teal" leftSection={<IconCircleCheck size={16} />} onClick={completeHandlers.open}>
                Complete production
              </Button>
            )}
          </Group>
        }
      />

      {/* ------------------------------ headline ----------------------------- */}
      <SimpleGrid cols={{ base: 2, md: 5 }} spacing="md" mb="md">
        <StatCard label="Planned" value={int(order.plannedQty)} sub="good units" compact />
        <StatCard
          label="Good output"
          value={int(order.goodQty)}
          sub={order.goodQty ? pct(v.yieldPercent) + ' yield' : 'not completed'}
          compact
          color="teal"
        />
        <StatCard
          label="Standard cost / unit"
          value={money(order.standardUnitCost, 4)}
          sub={money(order.standardTotalCost, 0) + ' total'}
          compact
          color="slate"
        />
        <StatCard
          label="Actual cost / unit"
          value={order.actualUnitCost ? money(order.actualUnitCost, 4) : '-'}
          sub={money(order.actualTotalCost, 0) + ' total'}
          compact
          color="biscuit"
        />
        <StatCard
          label="Total variance"
          value={money(order.totalVariance, 0)}
          sub={v.verdict === 'ADVERSE' ? 'Above standard' : 'At or below standard'}
          compact
          color={order.totalVariance > 0 ? 'red' : 'teal'}
        />
      </SimpleGrid>

      {order.status === 'IN_PROGRESS' && (
        <Alert color="indigo" variant="light" icon={<IconAlertTriangle size={18} />} mb="md">
          Material has been issued and is sitting in <b>work in process</b>. Complete the order to move good output
          into finished goods and clear WIP to the variance accounts.
        </Alert>
      )}

      <Tabs defaultValue="variance" keepMounted={false}>
        <Tabs.List mb="md">
          <Tabs.Tab value="variance" leftSection={<IconScale size={16} />}>
            Estimated vs actual
          </Tabs.Tab>
          <Tabs.Tab value="materials" leftSection={<IconChecklist size={16} />}>
            Material detail
          </Tabs.Tab>
          <Tabs.Tab value="ledger" leftSection={<IconReceipt size={16} />}>
            Journal entries
          </Tabs.Tab>
        </Tabs.List>

        {/* ------------------------------ variance --------------------------- */}
        <Tabs.Panel value="variance">
          <Grid gutter="md">
            <Grid.Col span={{ base: 12, lg: 7 }}>
              <Section title="Cost element comparison">
                <BarChart
                  h={230}
                  data={chartData}
                  dataKey="element"
                  withLegend
                  valueFormatter={(x) => money(x, 0)}
                  series={[
                    { name: 'Standard', color: 'slate.5' },
                    { name: 'Actual', color: 'biscuit.6' },
                  ]}
                />
              </Section>

              <Section title="Variance breakdown" description="Positive is adverse; negative is favourable.">
                <Table>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Variance</Table.Th>
                      <Table.Th ta="right">Amount</Table.Th>
                      <Table.Th ta="right">Per unit</Table.Th>
                      <Table.Th>Meaning</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    <VarianceRow
                      label="Material usage"
                      value={v.materialUsageVariance}
                      units={order.goodQty || order.plannedQty}
                      note="More or less material consumed than the formula allows, valued at standard rate"
                    />
                    <VarianceRow
                      label="Material price"
                      value={v.materialPriceVariance}
                      units={order.goodQty || order.plannedQty}
                      note="Difference between the standard rate and the rate stock was actually valued at"
                    />
                    <VarianceRow
                      label="Direct labour"
                      value={v.labourVariance}
                      units={order.goodQty || order.plannedQty}
                      note="Overtime, idle time or a different crew size"
                    />
                    <VarianceRow
                      label="Factory overhead"
                      value={v.overheadVariance}
                      units={order.goodQty || order.plannedQty}
                      note="Fuel, power and absorption differences"
                    />
                    <VarianceRow
                      label={'Yield loss (' + int(v.yieldLossUnits) + ' units)'}
                      value={v.yieldVariance}
                      units={order.goodQty || order.plannedQty}
                      note="Standard cost of units that did not survive to finished goods"
                      muted
                    />
                    <Table.Tr>
                      <Table.Td>
                        <Text fw={800}>Total cost variance</Text>
                      </Table.Td>
                      <Table.Td ta="right">
                        <VarianceText value={v.totalVariance} />
                      </Table.Td>
                      <Table.Td ta="right">
                        <VarianceText value={v.unitCostVariance} dp={4} />
                      </Table.Td>
                      <Table.Td>
                        <Badge variant="light" color={v.verdict === 'ADVERSE' ? 'red' : 'teal'}>
                          {v.verdict}
                        </Badge>
                      </Table.Td>
                    </Table.Tr>
                  </Table.Tbody>
                </Table>
              </Section>
            </Grid.Col>

            <Grid.Col span={{ base: 12, lg: 5 }}>
              <Section title="Order profile">
                <Stack gap={8}>
                  <Info label="Recipe" value={order.recipeCode + ' v' + order.recipeVersion} />
                  <Info label="Scale factor" value={num(order.scaleFactor, 4) + ' × base batch'} />
                  <Info label="Scheduled" value={date(order.scheduledDate)} />
                  <Info label="Shift / line" value={order.shift + ' · ' + order.lineNo} />
                  <Info label="Created by" value={order.createdBy?.name || '-'} />
                  <Info label="Materials issued" value={order.materialsIssuedAt ? dateTime(order.materialsIssuedAt) : 'Not yet'} />
                  <Info label="Completed" value={order.completedAt ? dateTime(order.completedAt) : 'Not yet'} />
                  <Info label="Completed by" value={order.completedBy?.name || '-'} />
                  {order.remarks && <Info label="Remarks" value={order.remarks} />}
                </Stack>
              </Section>

              <Section title="Output">
                <Stack gap="sm">
                  <div>
                    <Group justify="space-between" mb={4}>
                      <Text size="sm">Good units</Text>
                      <Text size="sm" fw={700} ff="monospace">
                        {int(order.goodQty)} / {int(order.plannedQty)}
                      </Text>
                    </Group>
                    <Progress
                      value={order.plannedQty ? (order.goodQty / order.plannedQty) * 100 : 0}
                      color={v.yieldPercent >= 97 ? 'teal' : v.yieldPercent >= 92 ? 'yellow' : 'red'}
                      size="lg"
                      radius="xl"
                    />
                  </div>
                  <Group justify="space-between">
                    <Text size="sm" c="dimmed">
                      Rejected
                    </Text>
                    <Text size="sm" ff="monospace">
                      {int(order.rejectQty)}
                    </Text>
                  </Group>
                  <Group justify="space-between">
                    <Text size="sm" c="dimmed">
                      Yield loss
                    </Text>
                    <Text size="sm" ff="monospace">
                      {int(v.yieldLossUnits)} units ({money(v.yieldVariance, 0)})
                    </Text>
                  </Group>
                </Stack>
              </Section>
            </Grid.Col>
          </Grid>
        </Tabs.Panel>

        {/* ------------------------------ materials -------------------------- */}
        <Tabs.Panel value="materials">
          <Section
            title="Material line detail"
            description="Standard is frozen from the approved recipe at order creation. Actual rate is the moving-average value the stock was relieved at."
          >
            <Table.ScrollContainer minWidth={1080}>
              <Table highlightOnHover fz="xs">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Code</Table.Th>
                    <Table.Th>Material</Table.Th>
                    <Table.Th ta="right">Std qty</Table.Th>
                    <Table.Th ta="right">Act qty</Table.Th>
                    <Table.Th ta="right">Qty var</Table.Th>
                    <Table.Th ta="right">Var %</Table.Th>
                    <Table.Th ta="right">Std rate</Table.Th>
                    <Table.Th ta="right">Act rate</Table.Th>
                    <Table.Th ta="right">Std cost</Table.Th>
                    <Table.Th ta="right">Act cost</Table.Th>
                    <Table.Th ta="right">Usage var</Table.Th>
                    <Table.Th ta="right">Price var</Table.Th>
                    <Table.Th />
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {(lines.length ? lines : order.lines).map((l) => (
                    <Table.Tr key={l.materialCode}>
                      <Table.Td ff="monospace">{l.materialCode}</Table.Td>
                      <Table.Td>{l.materialName}</Table.Td>
                      <Table.Td ta="right" ff="monospace">
                        {num(l.standardQty, 3)}
                      </Table.Td>
                      <Table.Td ta="right" ff="monospace">
                        {num(l.actualQty, 3)}
                      </Table.Td>
                      <Table.Td ta="right">
                        <VarianceText value={l.varianceQty ?? l.actualQty - l.standardQty} dp={3} asMoney={false} />
                      </Table.Td>
                      <Table.Td ta="right" c="dimmed">
                        {l.variancePercent != null ? num(l.variancePercent, 2) + '%' : '-'}
                      </Table.Td>
                      <Table.Td ta="right" ff="monospace">
                        {num(l.standardRate, 2)}
                      </Table.Td>
                      <Table.Td ta="right" ff="monospace">
                        {num(l.actualRate, 2)}
                      </Table.Td>
                      <Table.Td ta="right" ff="monospace">
                        {num(l.standardCost, 2)}
                      </Table.Td>
                      <Table.Td ta="right" ff="monospace" fw={600}>
                        {num(l.actualCost, 2)}
                      </Table.Td>
                      <Table.Td ta="right">
                        <VarianceText value={l.usageVarianceCost} />
                      </Table.Td>
                      <Table.Td ta="right">
                        <VarianceText value={l.priceVarianceCost} />
                      </Table.Td>
                      <Table.Td>
                        {l.status && (
                          <Badge
                            size="xs"
                            variant="light"
                            color={l.status === 'ADVERSE' ? 'red' : l.status === 'FAVOURABLE' ? 'teal' : 'gray'}
                          >
                            {l.status === 'ON_STANDARD' ? 'on std' : l.status.toLowerCase()}
                          </Badge>
                        )}
                      </Table.Td>
                    </Table.Tr>
                  ))}
                  <Table.Tr style={{ fontWeight: 700 }}>
                    <Table.Td colSpan={8}>TOTAL MATERIAL</Table.Td>
                    <Table.Td ta="right" ff="monospace">
                      {num(order.standardMaterialCost, 2)}
                    </Table.Td>
                    <Table.Td ta="right" ff="monospace">
                      {num(order.actualMaterialCost, 2)}
                    </Table.Td>
                    <Table.Td ta="right">
                      <VarianceText value={v.materialUsageVariance} />
                    </Table.Td>
                    <Table.Td ta="right">
                      <VarianceText value={v.materialPriceVariance} />
                    </Table.Td>
                    <Table.Td />
                  </Table.Tr>
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          </Section>
        </Tabs.Panel>

        {/* ------------------------------- ledger ---------------------------- */}
        <Tabs.Panel value="ledger">
          <Section
            title="Journal entries posted by this order"
            description="Material issue, conversion absorption and the completion entry that clears WIP."
          >
            {order.journalEntries?.length ? (
              <Stack gap="md">
                {order.journalEntries.map((je) => (
                  <Card key={je._id} withBorder p="sm">
                    <Group justify="space-between" mb="xs">
                      <div>
                        <Text fw={700} size="sm" ff="monospace">
                          {je.code}
                        </Text>
                        <Text size="xs" c="dimmed">
                          {je.narration}
                        </Text>
                      </div>
                      <Badge variant="light">{date(je.date)}</Badge>
                    </Group>
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
                              <Text size="xs" ff="monospace">
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
                        <Table.Tr style={{ fontWeight: 700 }}>
                          <Table.Td colSpan={2}>Total</Table.Td>
                          <Table.Td ta="right" ff="monospace">
                            {num(je.totalDebit, 2)}
                          </Table.Td>
                          <Table.Td ta="right" ff="monospace">
                            {num(je.totalCredit, 2)}
                          </Table.Td>
                        </Table.Tr>
                      </Table.Tbody>
                    </Table>
                  </Card>
                ))}
              </Stack>
            ) : (
              <Text c="dimmed" size="sm">
                Nothing has been posted for this order yet.
              </Text>
            )}
          </Section>
        </Tabs.Panel>
      </Tabs>

      {/* ---------------------------- issue modal ---------------------------- */}
      <Modal opened={issueOpen} onClose={issueHandlers.close} title="Issue materials to production" size="90%">
        <Text size="sm" c="dimmed" mb="sm">
          Enter what the store actually issued. Stock is relieved at moving average, and that rate becomes the
          actual cost — so the ledger and the stock ledger cannot drift apart.
        </Text>
        <ExcelGrid columns={issueColumns} rows={issueRows} onChange={setIssueRows} readOnly={false} minRows={1} />
        <Group justify="flex-end" mt="md">
          <Button variant="default" onClick={issueHandlers.close}>
            Cancel
          </Button>
          <Button
            loading={busy}
            leftSection={<IconPackageExport size={16} />}
            onClick={() =>
              runAction('issue', {
                lines: issueRows.map((r) => ({ materialCode: r.materialCode, actualQty: Number(r.actualQty) || 0 })),
              })
            }
          >
            Post material issue
          </Button>
        </Group>
      </Modal>

      {/* --------------------------- complete modal -------------------------- */}
      <Modal opened={completeOpen} onClose={completeHandlers.close} title="Complete production" size="lg">
        <Stack>
          <SimpleGrid cols={{ base: 1, xs: 2 }}>
            <NumberInput
              label="Good output (units)"
              description="Only good units are capitalised"
              value={completion.goodQty}
              onChange={(v) => setCompletion({ ...completion, goodQty: v })}
              min={0}
              thousandSeparator
            />
            <NumberInput
              label="Rejected units"
              value={completion.rejectQty}
              onChange={(v) => setCompletion({ ...completion, rejectQty: v })}
              min={0}
              thousandSeparator
            />
            <NumberInput
              label="Actual direct labour"
              description={'Standard ' + money(order.standardLabourCost, 0)}
              value={completion.actualLabourCost}
              onChange={(v) => setCompletion({ ...completion, actualLabourCost: v })}
              min={0}
              thousandSeparator
              prefix="Rs. "
            />
            <NumberInput
              label="Actual factory overhead"
              description={'Standard ' + money(order.standardOverheadCost, 0)}
              value={completion.actualOverheadCost}
              onChange={(v) => setCompletion({ ...completion, actualOverheadCost: v })}
              min={0}
              thousandSeparator
              prefix="Rs. "
            />
          </SimpleGrid>

          <Textarea
            label="Remarks"
            value={completion.remarks}
            onChange={(e) => setCompletion({ ...completion, remarks: e.currentTarget.value })}
            minRows={2}
          />

          <Card withBorder p="sm" bg="var(--mantine-color-default-hover)">
            <Text size="xs" fw={700} tt="uppercase" c="dimmed" mb={6}>
              What this will post
            </Text>
            <Stack gap={4}>
              <Info
                label="Dr Finished goods"
                value={money(completion.goodQty * order.standardUnitCost, 2)}
                small
              />
              <Info
                label="Dr Yield loss"
                value={money(Math.max(0, order.plannedQty - completion.goodQty) * order.standardUnitCost, 2)}
                small
              />
              <Info label="Dr / Cr Variance accounts" value="balancing" small />
              <Info
                label="Cr Work in process"
                value={money(
                  order.actualMaterialCost + completion.actualLabourCost + completion.actualOverheadCost,
                  2
                )}
                small
              />
            </Stack>
          </Card>

          <Group justify="flex-end">
            <Button variant="default" onClick={completeHandlers.close}>
              Cancel
            </Button>
            <Button
              color="teal"
              loading={busy}
              leftSection={<IconCheck size={16} />}
              onClick={() => runAction('complete', completion)}
            >
              Complete and post
            </Button>
          </Group>
        </Stack>
      </Modal>
    </PageTransition>
  );
}

function VarianceRow({ label, value, units, note, muted }) {
  return (
    <Table.Tr>
      <Table.Td>
        <Text size="sm" c={muted ? 'dimmed' : undefined}>
          {label}
        </Text>
      </Table.Td>
      <Table.Td ta="right">
        <VarianceText value={value} />
      </Table.Td>
      <Table.Td ta="right">
        <Text size="xs" c="dimmed" ff="monospace">
          {units ? num(value / units, 4) : '-'}
        </Text>
      </Table.Td>
      <Table.Td>
        <Text size="10px" c="dimmed">
          {note}
        </Text>
      </Table.Td>
    </Table.Tr>
  );
}

function Info({ label, value, small }) {
  return (
    <Group justify="space-between" wrap="nowrap" gap="md">
      <Text size={small ? '10px' : 'xs'} c="dimmed">
        {label}
      </Text>
      <Text size={small ? '10px' : 'xs'} fw={600} ff="monospace" ta="right">
        {value}
      </Text>
    </Group>
  );
}
