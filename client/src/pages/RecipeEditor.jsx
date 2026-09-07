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
  NumberInput,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Textarea,
  TextInput,
  Timeline,
  Title,
  Tooltip,
} from '@mantine/core';
import {
  IconAlertTriangle,
  IconArrowLeft,
  IconCalculator,
  IconChefHat,
  IconDeviceFloppy,
  IconFileTypePdf,
  IconInfoCircle,
  IconLock,
  IconSend,
} from '@tabler/icons-react';
import { api, downloadReport, showError, showSuccess } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { ExcelGrid } from '../components/ExcelGrid';
import {
  Loading,
  Money,
  PageHeader,
  PageTransition,
  Section,
  StatusBadge,
} from '../components/ui';
import { date, dateTime, int, money, num } from '../utils/format';

const blankLine = () => ({
  __key: Math.random().toString(36).slice(2),
  material: '',
  qty: 0,
  wastagePercent: 0,
  rate: 0,
  uom: '',
  remarks: '',
});

export default function RecipeEditorPage() {
  const { id } = useParams();
  const isNew = !id || id === 'new';
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { can } = useAuth();

  const [header, setHeader] = useState({
    productName: '',
    baseBatchQty: 1000,
    baseBatchUom: 'PCS',
    yieldPercent: 98,
    labourCostPerUnit: 0.32,
    factoryOverheadPerUnit: 0.68,
    adminOverheadPerUnit: 0.25,
    marketingOverheadPerUnit: 0.3,
    changeNote: '',
    product: '',
  });
  const [lines, setLines] = useState([blankLine()]);
  const [simQty, setSimQty] = useState(100000);
  const [saving, setSaving] = useState(false);

  const { data: materialsData } = useQuery({
    queryKey: ['materials'],
    queryFn: async () => (await api.get('/materials')).data.data,
  });

  const { data: recipeData, isLoading } = useQuery({
    queryKey: ['recipe', id],
    queryFn: async () => (await api.get('/recipes/' + id)).data,
    enabled: !isNew,
  });

  const materials = materialsData || [];
  const materialById = useMemo(() => new Map(materials.map((m) => [m._id, m])), [materials]);

  const rawOptions = useMemo(
    () =>
      materials
        .filter((m) => ['RAW', 'PACKAGING', 'CONSUMABLE'].includes(m.category))
        .map((m) => ({ value: m._id, label: m.code + ' - ' + m.name })),
    [materials]
  );
  const finishedOptions = useMemo(
    () => materials.filter((m) => m.category === 'FINISHED').map((m) => ({ value: m._id, label: m.name })),
    [materials]
  );

  useEffect(() => {
    if (!recipeData) return;
    const r = recipeData.data;
    setHeader({
      productName: r.productName,
      baseBatchQty: r.baseBatchQty,
      baseBatchUom: r.baseBatchUom,
      yieldPercent: r.yieldPercent,
      labourCostPerUnit: r.labourCostPerUnit,
      factoryOverheadPerUnit: r.factoryOverheadPerUnit,
      adminOverheadPerUnit: r.adminOverheadPerUnit,
      marketingOverheadPerUnit: r.marketingOverheadPerUnit,
      changeNote: r.changeNote || '',
      product: r.product?._id || r.product || '',
    });
    setLines(
      r.lines.map((l) => ({
        __key: Math.random().toString(36).slice(2),
        material: l.material?._id || l.material,
        qty: l.qty,
        wastagePercent: l.wastagePercent,
        rate: l.rate,
        uom: l.uom,
        remarks: l.remarks || '',
      }))
    );
    setSimQty(r.baseBatchQty * 100);
  }, [recipeData]);

  const recipe = recipeData?.data;
  const locked = !isNew && !['DRAFT', 'REJECTED'].includes(recipe?.status);
  const editable = can('recipe.create') && !locked;

  /* --------------------------- live cost engine --------------------------- */
  /* mirrors server/src/services/costing.js so the sheet updates as you type   */

  const computed = useMemo(() => {
    const good = Math.max(1, (Number(header.baseBatchQty) || 1) * (Number(header.yieldPercent) || 100) / 100);
    const withCost = lines.map((l) => {
      const qty = Number(l.qty) || 0;
      const rate = Number(l.rate) || 0;
      const effectiveQty = qty * (1 + (Number(l.wastagePercent) || 0) / 100);
      return { ...l, effectiveQty, lineCost: effectiveQty * rate };
    });
    const materialCostPerBatch = withCost.reduce((s, l) => s + l.lineCost, 0);
    const materialCostPerUnit = materialCostPerBatch / good;
    const manufacturing =
      materialCostPerUnit + (Number(header.labourCostPerUnit) || 0) + (Number(header.factoryOverheadPerUnit) || 0);
    const full =
      manufacturing + (Number(header.adminOverheadPerUnit) || 0) + (Number(header.marketingOverheadPerUnit) || 0);
    return {
      goodUnits: good,
      scrapUnits: (Number(header.baseBatchQty) || 0) - good,
      lines: withCost,
      materialCostPerBatch,
      materialCostPerUnit,
      manufacturingCostPerUnit: manufacturing,
      fullCostPerUnit: full,
    };
  }, [lines, header]);

  /* ------------------------------ grid columns ---------------------------- */

  const columns = useMemo(
    () => [
      {
        key: 'material',
        title: 'Material',
        width: 230,
        type: 'select',
        options: rawOptions,
        required: true,
        validate: (v) => (!v ? 'Pick a material' : null),
        // picking a material pulls in its UOM and current rate
        onCellChange: (row, value) => {
          const m = materialById.get(value);
          return m ? { ...row, uom: m.uom, rate: m.movingAvgRate || m.standardRate } : row;
        },
      },
      {
        key: 'qty',
        title: 'Qty / batch',
        width: 110,
        type: 'number',
        align: 'right',
        precision: 3,
        min: 0,
        required: true,
        total: true,
        validate: (v) => (Number(v) > 0 ? null : 'Quantity must be greater than zero'),
      },
      { key: 'uom', title: 'UOM', width: 66, editable: false, align: 'center' },
      {
        key: 'wastagePercent',
        title: 'Wastage %',
        width: 96,
        type: 'number',
        align: 'right',
        precision: 2,
        min: 0,
        max: 100,
      },
      {
        key: '__effective',
        title: 'Effective qty',
        width: 110,
        type: 'computed',
        align: 'right',
        precision: 3,
        compute: (row) => (Number(row.qty) || 0) * (1 + (Number(row.wastagePercent) || 0) / 100),
        format: (v) => num(v, 3),
      },
      {
        key: 'rate',
        title: 'Rate',
        width: 100,
        type: 'number',
        align: 'right',
        precision: 2,
        min: 0,
      },
      {
        key: '__cost',
        title: 'Batch cost',
        width: 118,
        type: 'computed',
        align: 'right',
        precision: 2,
        total: true,
        compute: (row) =>
          (Number(row.qty) || 0) * (1 + (Number(row.wastagePercent) || 0) / 100) * (Number(row.rate) || 0),
        format: (v) => num(v, 2),
      },
      {
        key: '__perUnit',
        title: 'Per unit',
        width: 100,
        type: 'computed',
        align: 'right',
        precision: 4,
        compute: (row) => {
          const good = Math.max(
            1,
            ((Number(header.baseBatchQty) || 1) * (Number(header.yieldPercent) || 100)) / 100
          );
          return (
            ((Number(row.qty) || 0) * (1 + (Number(row.wastagePercent) || 0) / 100) * (Number(row.rate) || 0)) /
            good
          );
        },
        format: (v) => num(v, 4),
      },
      { key: 'remarks', title: 'Remarks', width: 170 },
    ],
    [rawOptions, materialById, header.baseBatchQty, header.yieldPercent]
  );

  /* -------------------------------- saving -------------------------------- */

  const buildPayload = () => ({
    ...header,
    product: header.product || undefined,
    lines: lines
      .filter((l) => l.material && Number(l.qty) > 0)
      .map((l) => ({
        material: l.material,
        qty: Number(l.qty),
        rate: Number(l.rate) || 0,
        wastagePercent: Number(l.wastagePercent) || 0,
        remarks: l.remarks || '',
      })),
  });

  const save = async ({ thenSubmit = false } = {}) => {
    const payload = buildPayload();
    if (!payload.productName?.trim()) return showError({ friendly: 'Give the recipe a product name' }, 'Cannot save');
    if (!payload.lines.length) return showError({ friendly: 'Add at least one material line' }, 'Cannot save');

    setSaving(true);
    try {
      let saved;
      if (isNew) {
        saved = (await api.post('/recipes', payload)).data.data;
      } else {
        saved = (await api.put('/recipes/' + id, payload)).data.data;
      }
      showSuccess(saved.code + ' v' + saved.version + ' saved');

      if (thenSubmit) {
        await api.post('/recipes/' + saved._id + '/submit');
        showSuccess('Sent for approval', 'Submitted');
      }

      qc.invalidateQueries({ queryKey: ['recipes'] });
      qc.invalidateQueries({ queryKey: ['recipe', saved._id] });
      navigate('/recipes/' + saved._id, { replace: true });
    } catch (e) {
      showError(e, 'Could not save the recipe');
    } finally {
      setSaving(false);
    }
    return undefined;
  };

  if (!isNew && isLoading) return <Loading label="Loading recipe" />;

  const scale = simQty / Math.max(1, computed.goodUnits);

  return (
    <PageTransition>
      <PageHeader
        icon={IconChefHat}
        title={isNew ? 'New recipe' : recipe?.code + ' — ' + recipe?.productName}
        badge={recipe && <StatusBadge status={recipe.status} />}
        subtitle={
          isNew
            ? 'Enter the formula for one base batch. Quantities scale automatically to any production volume.'
            : 'Version ' + recipe?.version + ' · prepared by ' + (recipe?.preparedBy?.name || '-')
        }
        actions={
          <Group gap="xs">
            <Button variant="subtle" leftSection={<IconArrowLeft size={16} />} onClick={() => navigate('/recipes')}>
              Back
            </Button>
            {!isNew && (
              <Button
                variant="default"
                leftSection={<IconFileTypePdf size={16} />}
                onClick={() =>
                  downloadReport('recipe-cost-sheet', { format: 'pdf', params: { id } })
                    .then((n) => showSuccess(n + ' downloaded'))
                    .catch(showError)
                }
              >
                Cost sheet
              </Button>
            )}
            {editable && (
              <>
                <Button
                  variant="light"
                  leftSection={<IconDeviceFloppy size={16} />}
                  loading={saving}
                  onClick={() => save()}
                >
                  Save draft
                </Button>
                {can('recipe.submit') && (
                  <Button
                    leftSection={<IconSend size={16} />}
                    loading={saving}
                    onClick={() => save({ thenSubmit: true })}
                  >
                    Save and submit
                  </Button>
                )}
              </>
            )}
          </Group>
        }
      />

      {locked && (
        <Alert color="blue" variant="light" icon={<IconLock size={18} />} mb="md">
          This version is <b>{recipe.status.toLowerCase().replace('_', ' ')}</b> and is locked for editing. Use{' '}
          <b>Create next version</b> on the recipe list to change the formula — the approved version stays in force
          until the new one is approved.
        </Alert>
      )}
      {recipe?.status === 'REJECTED' && recipe?.rejectionReason && (
        <Alert color="red" variant="light" icon={<IconAlertTriangle size={18} />} mb="md" title="Rejected">
          {recipe.rejectionReason}
        </Alert>
      )}

      <Grid gutter="md">
        <Grid.Col span={{ base: 12, lg: 8 }}>
          <Section title="Header">
            <SimpleGrid cols={{ base: 1, xs: 2, md: 4 }} spacing="sm">
              <TextInput
                label="Product name"
                value={header.productName}
                onChange={(e) => setHeader({ ...header, productName: e.currentTarget.value })}
                disabled={!editable}
                required
              />
              <NumberInput
                label="Base batch (gross units)"
                description="Units one batch yields before scrap"
                value={header.baseBatchQty}
                onChange={(v) => setHeader({ ...header, baseBatchQty: v })}
                min={1}
                thousandSeparator
                disabled={!editable}
              />
              <NumberInput
                label="Yield %"
                description="Share that comes out saleable"
                value={header.yieldPercent}
                onChange={(v) => setHeader({ ...header, yieldPercent: v })}
                min={1}
                max={100}
                suffix="%"
                disabled={!editable}
              />
              <TextInput
                label="Finished item"
                description="Stock item that receives the output"
                value={finishedOptions.find((o) => o.value === header.product)?.label || ''}
                onChange={() => {}}
                readOnly
                placeholder="Not linked"
              />
            </SimpleGrid>

            <SimpleGrid cols={{ base: 2, md: 4 }} spacing="sm" mt="sm">
              <NumberInput
                label="Direct labour / unit"
                value={header.labourCostPerUnit}
                onChange={(v) => setHeader({ ...header, labourCostPerUnit: v })}
                decimalScale={4}
                step={0.01}
                min={0}
                prefix="Rs. "
                disabled={!editable}
              />
              <NumberInput
                label="Factory overhead / unit"
                value={header.factoryOverheadPerUnit}
                onChange={(v) => setHeader({ ...header, factoryOverheadPerUnit: v })}
                decimalScale={4}
                step={0.01}
                min={0}
                prefix="Rs. "
                disabled={!editable}
              />
              <NumberInput
                label="Admin / unit"
                description="Management cost only"
                value={header.adminOverheadPerUnit}
                onChange={(v) => setHeader({ ...header, adminOverheadPerUnit: v })}
                decimalScale={4}
                step={0.01}
                min={0}
                prefix="Rs. "
                disabled={!editable}
              />
              <NumberInput
                label="Marketing / unit"
                description="Management cost only"
                value={header.marketingOverheadPerUnit}
                onChange={(v) => setHeader({ ...header, marketingOverheadPerUnit: v })}
                decimalScale={4}
                step={0.01}
                min={0}
                prefix="Rs. "
                disabled={!editable}
              />
            </SimpleGrid>

            {editable && (
              <Textarea
                mt="sm"
                label="Change note"
                placeholder="What is different about this version?"
                value={header.changeNote}
                onChange={(e) => setHeader({ ...header, changeNote: e.currentTarget.value })}
                minRows={2}
              />
            )}
          </Section>
        </Grid.Col>

        {/* ------------------------------ sidebar ----------------------------- */}
        <Grid.Col span={{ base: 12, lg: 4 }}>
          <Card mb="md">
            <Group justify="space-between" mb="sm">
              <Title order={3}>Cost build-up</Title>
              <Badge variant="light" color="biscuit">
                per good unit
              </Badge>
            </Group>

            <Stack gap={8}>
              <Row label="Material cost / batch" value={money(computed.materialCostPerBatch)} />
              <Row
                label={'Good units / batch'}
                value={int(computed.goodUnits) + ' of ' + int(header.baseBatchQty)}
                dim
              />
              <Row label="Material / unit" value={money(computed.materialCostPerUnit, 4)} />
              <Row label="Direct labour" value={money(header.labourCostPerUnit, 4)} dim />
              <Row label="Factory overhead" value={money(header.factoryOverheadPerUnit, 4)} dim />
              <Divider />
              <Row label="Manufacturing cost" value={money(computed.manufacturingCostPerUnit, 4)} strong />
              <Row label="Admin absorption" value={money(header.adminOverheadPerUnit, 4)} dim />
              <Row label="Marketing absorption" value={money(header.marketingOverheadPerUnit, 4)} dim />
              <Divider />
              <Row label="Full management cost" value={money(computed.fullCostPerUnit, 4)} strong accent />
            </Stack>

            <Alert mt="md" color="blue" variant="light" icon={<IconInfoCircle size={16} />} p="xs">
              <Text size="xs">
                Inventory is valued at <b>manufacturing cost</b>. Admin and marketing are period costs and are shown
                separately for management pricing decisions only.
              </Text>
            </Alert>
          </Card>
        </Grid.Col>

        {/* ------------------------------ full-width recipe lines grid ----------------------------- */}
        <Grid.Col span={12}>
          <Section
            title="Recipe lines"
            description="Type straight into the sheet. Tab moves across, Enter edits, Ctrl+V pastes a block from Excel."
          >
            <ExcelGrid
              columns={columns}
              rows={lines}
              onChange={setLines}
              emptyRow={blankLine}
              readOnly={!editable}
              minRows={1}
            />
          </Section>
        </Grid.Col>

        <Grid.Col span={{ base: 12, md: 6 }}>
          <Section title="Scale this formula" description="What the same recipe needs at production volume">
            <NumberInput
              label="Production quantity (good units)"
              value={simQty}
              onChange={setSimQty}
              min={1}
              thousandSeparator
              leftSection={<IconCalculator size={16} />}
              mb="sm"
            />
            <Table.ScrollContainer minWidth={280}>
              <Table fz="xs">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Material</Table.Th>
                    <Table.Th ta="right">Required</Table.Th>
                    <Table.Th ta="right">Cost</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {computed.lines
                    .filter((l) => l.material)
                    .map((l) => (
                      <Table.Tr key={l.__key}>
                        <Table.Td>
                          <Text size="xs" lineClamp={1}>
                            {materialById.get(l.material)?.name || '-'}
                          </Text>
                        </Table.Td>
                        <Table.Td ta="right" ff="monospace">
                          {num(l.effectiveQty * scale, 2)} {l.uom}
                        </Table.Td>
                        <Table.Td ta="right" ff="monospace">
                          {num(l.lineCost * scale, 0)}
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  <Table.Tr>
                    <Table.Td fw={700}>Total material</Table.Td>
                    <Table.Td />
                    <Table.Td ta="right" fw={700} ff="monospace">
                      {num(computed.materialCostPerBatch * scale, 0)}
                    </Table.Td>
                  </Table.Tr>
                  <Table.Tr>
                    <Table.Td fw={700}>Manufacturing cost</Table.Td>
                    <Table.Td />
                    <Table.Td ta="right" fw={700} ff="monospace">
                      {num(computed.manufacturingCostPerUnit * simQty, 0)}
                    </Table.Td>
                  </Table.Tr>
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          </Section>
        </Grid.Col>

        {recipeData?.versions?.length > 1 && (
          <Grid.Col span={{ base: 12, md: 6 }}>
            <Section title="Version history">
              <Timeline active={0} bulletSize={18} lineWidth={2}>
                {recipeData.versions.map((v) => (
                  <Timeline.Item
                    key={v._id}
                    title={
                      <Group gap="xs">
                        <Text fw={700} size="sm">
                          v{v.version}
                        </Text>
                        <StatusBadge status={v.status} />
                      </Group>
                    }
                  >
                    <Text size="xs" c="dimmed">
                      {v.approvedBy ? 'Approved by ' + v.approvedBy.name : 'Submitted by ' + (v.submittedBy?.name || '-')}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {dateTime(v.approvedAt || v.createdAt)}
                    </Text>
                    {v.changeNote && (
                      <Text size="xs" mt={4}>
                        {v.changeNote}
                      </Text>
                    )}
                    <Text size="xs" c="dimmed" mt={2}>
                      Mfg cost {money(v.manufacturingCostPerUnit, 4)}
                    </Text>
                  </Timeline.Item>
                ))}
              </Timeline>
            </Section>
          </Grid.Col>
        )}
      </Grid>
    </PageTransition>
  );
}

function Row({ label, value, dim, strong, accent }) {
  return (
    <Group justify="space-between" wrap="nowrap">
      <Text size={strong ? 'sm' : 'xs'} c={dim ? 'dimmed' : undefined} fw={strong ? 700 : 400}>
        {label}
      </Text>
      <Text
        size={strong ? 'sm' : 'xs'}
        ff="monospace"
        fw={strong ? 800 : 500}
        c={accent ? 'biscuit.7' : undefined}
      >
        {value}
      </Text>
    </Group>
  );
}

function Divider() {
  return <div style={{ height: 1, background: 'var(--mantine-color-default-border)', margin: '4px 0' }} />;
}
