import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Badge,
  Button,
  Card,
  Divider,
  Group,
  Modal,
  NumberInput,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Tabs,
  Text,
  Textarea,
  TextInput,
  Tooltip,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import {
  IconCheck,
  IconCircleCheck,
  IconClock,
  IconFileCheck,
  IconFilePlus,
  IconGavel,
  IconPackageImport,
  IconPlus,
  IconReceipt2,
  IconSearch,
  IconShoppingCart,
  IconTruckDelivery,
  IconX,
} from '@tabler/icons-react';
import { api, downloadReport, showError, showSuccess } from '../api/client';
import { useAuth } from '../context/AuthContext';
import {
  EmptyState,
  ExportMenu,
  Loading,
  Money,
  PageHeader,
  PageTransition,
  Section,
  StatCard,
  StatusBadge,
} from '../components/ui';
import { dateTime, money, num } from '../utils/format';

export default function ProcurementPage() {
  const qc = useQueryClient();
  const { user, can } = useAuth();
  const [activeTab, setActiveTab] = useState('orders');

  /* ------------------------------- State ---------------------------------- */
  const [search, setSearch] = useState('');
  const [poModalOpen, poModalHandlers] = useDisclosure(false);
  const [rfqModalOpen, rfqModalHandlers] = useDisclosure(false);
  const [quoteModalOpen, quoteModalHandlers] = useDisclosure(false);
  const [grnModalOpen, grnModalHandlers] = useDisclosure(false);
  const [matchModalOpen, matchModalHandlers] = useDisclosure(false);

  // Selected item for modals
  const [selectedPo, setSelectedPo] = useState(null);
  const [selectedRfq, setSelectedRfq] = useState(null);
  const [matchData, setMatchData] = useState(null);

  // PO Form State
  const [poForm, setPoForm] = useState({
    supplier: '',
    reference: '',
    deliveryLocation: 'RM Store',
    paymentTerms: '30 days',
    remarks: '',
    lines: [{ material: '', qty: 100, rate: 0, remarks: '' }],
  });

  // RFQ Form State
  const [rfqForm, setRfqForm] = useState({
    title: '',
    suppliers: [],
    deadline: '',
    remarks: '',
    lines: [{ material: '', qty: 100, targetRate: 0 }],
  });

  // Quote Form State
  const [quoteForm, setQuoteForm] = useState({
    supplier: '',
    validUntil: '',
    deliveryDays: 7,
    paymentTerms: '30 days',
    lines: [],
  });

  // GRN Form State
  const [grnForm, setGrnForm] = useState({
    purchaseOrder: '',
    deliveryNote: '',
    vehicleNo: '',
    location: 'RM Store',
    lines: [],
  });

  /* ------------------------------- Queries -------------------------------- */
  const { data: posData, isLoading: posLoading } = useQuery({
    queryKey: ['purchase-orders'],
    queryFn: async () => (await api.get('/purchase-orders')).data,
  });

  const { data: rfqsData } = useQuery({
    queryKey: ['rfqs'],
    queryFn: async () => (await api.get('/rfqs')).data,
  });

  const { data: grnsData } = useQuery({
    queryKey: ['grns'],
    queryFn: async () => (await api.get('/grns')).data,
  });

  const { data: partiesData } = useQuery({
    queryKey: ['parties'],
    queryFn: async () => (await api.get('/parties')).data.data,
  });

  const { data: materialsData } = useQuery({
    queryKey: ['materials'],
    queryFn: async () => (await api.get('/materials')).data.data,
  });

  const pos = posData?.data || [];
  const rfqs = rfqsData?.data || [];
  const grns = grnsData?.data || [];
  const parties = partiesData || [];
  const materials = materialsData || [];

  const suppliers = useMemo(
    () => parties.filter((p) => ['SUPPLIER', 'BOTH'].includes(p.kind)).map((p) => ({ value: p._id, label: p.name })),
    [parties]
  );

  const materialOptions = useMemo(
    () =>
      materials
        .filter((m) => ['RAW', 'PACKAGING', 'CONSUMABLE'].includes(m.category))
        .map((m) => ({ value: m._id, label: `${m.code} - ${m.name} (${m.uom})` })),
    [materials]
  );

  const materialById = useMemo(() => new Map(materials.map((m) => [m._id, m])), [materials]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['purchase-orders'] });
    qc.invalidateQueries({ queryKey: ['rfqs'] });
    qc.invalidateQueries({ queryKey: ['grns'] });
    qc.invalidateQueries({ queryKey: ['inventory'] });
    qc.invalidateQueries({ queryKey: ['materials'] });
  };

  /* ------------------------------ Mutations ------------------------------- */
  const createPoMutation = useMutation({
    mutationFn: (payload) => api.post('/purchase-orders', payload),
    onSuccess: (res) => {
      showSuccess(`Purchase Order ${res.data.data.code} created`);
      invalidate();
      poModalHandlers.close();
    },
    onError: showError,
  });

  const submitPoMutation = useMutation({
    mutationFn: (id) => api.post(`/purchase-orders/${id}/submit`),
    onSuccess: () => {
      showSuccess('Submitted for departmental approval');
      invalidate();
    },
    onError: showError,
  });

  const approvePoMutation = useMutation({
    mutationFn: (id) => api.post(`/purchase-orders/${id}/approve`),
    onSuccess: () => {
      showSuccess('Purchase Order approved');
      invalidate();
    },
    onError: showError,
  });

  const createRfqMutation = useMutation({
    mutationFn: (payload) => api.post('/rfqs', payload),
    onSuccess: (res) => {
      showSuccess(`RFQ ${res.data.data.code} created`);
      invalidate();
      rfqModalHandlers.close();
    },
    onError: showError,
  });

  const recordQuoteMutation = useMutation({
    mutationFn: ({ id, payload }) => api.post(`/rfqs/${id}/quote`, payload),
    onSuccess: () => {
      showSuccess('Supplier quotation recorded');
      invalidate();
      quoteModalHandlers.close();
    },
    onError: showError,
  });

  const awardRfqMutation = useMutation({
    mutationFn: ({ id, supplier }) => api.post(`/rfqs/${id}/award`, { supplier }),
    onSuccess: (res) => {
      showSuccess(`RFQ awarded! Generated Purchase Order ${res.data.po?.code}`);
      invalidate();
    },
    onError: showError,
  });

  const createGrnMutation = useMutation({
    mutationFn: (payload) => api.post('/grns', payload),
    onSuccess: (res) => {
      showSuccess(`Goods Receipt ${res.data.data.code} created and posted to inventory & GL`);
      invalidate();
      grnModalHandlers.close();
    },
    onError: showError,
  });

  /* ------------------------------- Handlers ------------------------------- */
  const openGrnForPo = (po) => {
    setSelectedPo(po);
    setGrnForm({
      purchaseOrder: po._id,
      deliveryNote: '',
      vehicleNo: '',
      location: 'RM Store',
      lines: po.lines.map((l) => ({
        material: l.material?._id || l.material,
        materialCode: l.materialCode,
        materialName: l.materialName,
        uom: l.uom,
        orderedQty: l.qty,
        previouslyReceived: l.receivedQty || 0,
        receivedQty: Math.max(0, l.qty - (l.receivedQty || 0)),
        acceptedQty: Math.max(0, l.qty - (l.receivedQty || 0)),
        rejectedQty: 0,
        rate: l.rate,
        qcStatus: 'PASSED',
        remarks: '',
      })),
    });
    grnModalHandlers.open();
  };

  const view3WayMatch = async (po) => {
    try {
      const res = await api.get(`/purchase-orders/${po._id}/match`);
      setMatchData(res.data.data);
      matchModalHandlers.open();
    } catch (e) {
      showError(e);
    }
  };

  const openQuoteModal = (rfq) => {
    setSelectedRfq(rfq);
    setQuoteForm({
      supplier: '',
      validUntil: '',
      deliveryDays: 7,
      paymentTerms: '30 days',
      lines: rfq.lines.map((l) => ({
        material: l.material?._id || l.material,
        materialCode: l.materialCode,
        materialName: l.materialName,
        rate: l.targetRate || 0,
      })),
    });
    quoteModalHandlers.open();
  };

  if (posLoading) return <Loading label="Loading Procurement Module" />;

  return (
    <PageTransition>
      <PageHeader
        icon={IconShoppingCart}
        title="Procurement & Supply Chain"
        subtitle="Manage RFQs, Supplier Quotation Bids, Purchase Orders, Goods Receipt (GRN), and 3-Way Match Verification"
        actions={
          <Group gap="xs">
            <ExportMenu reportKey="purchase-order-summary" title="PO Report" />
            {can('rfq.manage') && (
              <Button variant="light" leftSection={<IconFilePlus size={16} />} onClick={rfqModalHandlers.open}>
                New RFQ
              </Button>
            )}
            {can('po.create') && (
              <Button leftSection={<IconPlus size={16} />} onClick={poModalHandlers.open}>
                Create Purchase Order
              </Button>
            )}
          </Group>
        }
      />

      {/* STATS OVERVIEW */}
      <SimpleGrid cols={{ base: 1, sm: 2, md: 4 }} spacing="md" mb="lg">
        <StatCard
          title="Open Purchase Orders"
          value={posData?.summary?.open || 0}
          subtext="Approved & awaiting delivery"
          icon={IconTruckDelivery}
          color="amber"
        />
        <StatCard
          title="Awaiting Approval"
          value={posData?.summary?.awaitingApproval || 0}
          subtext="Escalated to management"
          icon={IconClock}
          color="blue"
        />
        <StatCard
          title="Total PO Value"
          value={money(posData?.summary?.value || 0)}
          subtext="Total committed spend"
          icon={IconShoppingCart}
          color="emerald"
        />
        <StatCard
          title="Goods Receipts (GRNs)"
          value={grns.length}
          subtext="Posted stock receipts"
          icon={IconPackageImport}
          color="teal"
        />
      </SimpleGrid>

      {/* MODULE TABS */}
      <Tabs value={activeTab} onChange={setActiveTab} variant="outline" radius="md">
        <Tabs.List mb="md">
          <Tabs.Tab value="orders" leftSection={<IconShoppingCart size={16} />}>
            Purchase Orders ({pos.length})
          </Tabs.Tab>
          <Tabs.Tab value="rfqs" leftSection={<IconFilePlus size={16} />}>
            Requests for Quotation ({rfqs.length})
          </Tabs.Tab>
          <Tabs.Tab value="grns" leftSection={<IconPackageImport size={16} />}>
            Goods Receipt Notes ({grns.length})
          </Tabs.Tab>
        </Tabs.List>

        {/* TAB 1: PURCHASE ORDERS */}
        <Tabs.Panel value="orders">
          <Card p="md">
            <Group justify="space-between" mb="md">
              <TextInput
                placeholder="Search PO code or supplier..."
                leftSection={<IconSearch size={16} />}
                value={search}
                onChange={(e) => setSearch(e.currentTarget.value)}
                style={{ width: 300 }}
              />
            </Group>

            <Table.ScrollContainer minWidth={900}>
              <Table highlightOnHover verticalSpacing="sm">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>PO Code</Table.Th>
                    <Table.Th>Date</Table.Th>
                    <Table.Th>Supplier</Table.Th>
                    <Table.Th>Location</Table.Th>
                    <Table.Th ta="right">Grand Total</Table.Th>
                    <Table.Th>Status</Table.Th>
                    <Table.Th ta="right">Actions</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {pos
                    .filter((p) => p.code.toLowerCase().includes(search.toLowerCase()) || p.supplierName?.toLowerCase().includes(search.toLowerCase()))
                    .map((po) => (
                      <Table.Tr key={po._id}>
                        <Table.Td fw={700} ff="monospace">
                          {po.code}
                        </Table.Td>
                        <Table.Td>{dateTime(po.date)}</Table.Td>
                        <Table.Td>{po.supplierName}</Table.Td>
                        <Table.Td>{po.deliveryLocation}</Table.Td>
                        <Table.Td ta="right" fw={700} ff="monospace">
                          {money(po.grandTotal)}
                        </Table.Td>
                        <Table.Td>
                          <StatusBadge status={po.status} />
                        </Table.Td>
                        <Table.Td ta="right">
                          <Group gap={6} justify="flex-end">
                            <Tooltip label="View 3-Way Match Matrix">
                              <Button size="xs" variant="subtle" color="blue" onClick={() => view3WayMatch(po)}>
                                <IconReceipt2 size={16} />
                              </Button>
                            </Tooltip>

                            {po.status === 'DRAFT' && can('po.submit') && (
                              <Button
                                size="xs"
                                variant="light"
                                color="amber"
                                onClick={() => submitPoMutation.mutate(po._id)}
                              >
                                Submit
                              </Button>
                            )}

                            {po.status === 'PENDING_APPROVAL' && can('po.approve') && (
                              <Button
                                size="xs"
                                color="emerald"
                                onClick={() => approvePoMutation.mutate(po._id)}
                              >
                                Approve
                              </Button>
                            )}

                            {['APPROVED', 'PARTIALLY_RECEIVED'].includes(po.status) && can('grn.create') && (
                              <Button
                                size="xs"
                                variant="light"
                                color="teal"
                                leftSection={<IconPackageImport size={14} />}
                                onClick={() => openGrnForPo(po)}
                              >
                                Receive Goods
                              </Button>
                            )}

                            <Button
                              size="xs"
                              variant="subtle"
                              onClick={() =>
                                downloadReport('purchase-order-detail', { format: 'pdf', params: { id: po._id } })
                                  .then(() => showSuccess('PO PDF downloaded'))
                                  .catch(showError)
                              }
                            >
                              PDF
                            </Button>
                          </Group>
                        </Table.Td>
                      </Table.Tr>
                    ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          </Card>
        </Tabs.Panel>

        {/* TAB 2: REQUESTS FOR QUOTATION (RFQs) */}
        <Tabs.Panel value="rfqs">
          <Card p="md">
            <Table.ScrollContainer minWidth={800}>
              <Table highlightOnHover verticalSpacing="sm">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>RFQ Code</Table.Th>
                    <Table.Th>Title</Table.Th>
                    <Table.Th>Status</Table.Th>
                    <Table.Th>Quotes Received</Table.Th>
                    <Table.Th ta="right">Actions</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {rfqs.map((rfq) => (
                    <Table.Tr key={rfq._id}>
                      <Table.Td fw={700} ff="monospace">
                        {rfq.code}
                      </Table.Td>
                      <Table.Td>{rfq.title}</Table.Td>
                      <Table.Td>
                        <StatusBadge status={rfq.status} />
                      </Table.Td>
                      <Table.Td>{rfq.quotations?.length || 0} quotes</Table.Td>
                      <Table.Td ta="right">
                        <Group gap={6} justify="flex-end">
                          {rfq.status === 'PUBLISHED' && (
                            <>
                              <Button size="xs" variant="light" onClick={() => openQuoteModal(rfq)}>
                                Record Quote
                              </Button>
                              {rfq.quotations?.length > 0 && (
                                <Select
                                  placeholder="Award supplier"
                                  size="xs"
                                  data={rfq.quotations.map((q) => ({
                                    value: q.supplier?._id || q.supplier,
                                    label: `Award: ${q.supplierName} (${money(q.totalAmount)})`,
                                  }))}
                                  onChange={(val) => val && awardRfqMutation.mutate({ id: rfq._id, supplier: val })}
                                />
                              )}
                            </>
                          )}
                        </Group>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          </Card>
        </Tabs.Panel>

        {/* TAB 3: GOODS RECEIPT NOTES (GRNs) */}
        <Tabs.Panel value="grns">
          <Card p="md">
            <Table.ScrollContainer minWidth={850}>
              <Table highlightOnHover verticalSpacing="sm">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>GRN Code</Table.Th>
                    <Table.Th>Date</Table.Th>
                    <Table.Th>PO Ref</Table.Th>
                    <Table.Th>Supplier</Table.Th>
                    <Table.Th ta="right">Total Value</Table.Th>
                    <Table.Th>QC Outcome</Table.Th>
                    <Table.Th>Status</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {grns.map((g) => (
                    <Table.Tr key={g._id}>
                      <Table.Td fw={700} ff="monospace">
                        {g.code}
                      </Table.Td>
                      <Table.Td>{dateTime(g.date)}</Table.Td>
                      <Table.Td ff="monospace">{g.purchaseOrderCode || '-'}</Table.Td>
                      <Table.Td>{g.supplierName}</Table.Td>
                      <Table.Td ta="right" fw={700} ff="monospace">
                        {money(g.totalValue)}
                      </Table.Td>
                      <Table.Td>
                        <Badge color={g.totalRejected > 0 ? 'orange' : 'teal'}>
                          Accepted: {num(g.totalAccepted, 2)} | Rejected: {num(g.totalRejected, 2)}
                        </Badge>
                      </Table.Td>
                      <Table.Td>
                        <StatusBadge status={g.status} />
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          </Card>
        </Tabs.Panel>
      </Tabs>

      {/* CREATE PURCHASE ORDER MODAL */}
      <Modal opened={poModalOpen} onClose={poModalHandlers.close} title="Create Purchase Order" size="lg">
        <Stack gap="sm">
          <SimpleGrid cols={2}>
            <Select
              label="Supplier"
              placeholder="Select supplier"
              data={suppliers}
              value={poForm.supplier}
              onChange={(v) => setPoForm({ ...poForm, supplier: v })}
              required
            />
            <TextInput
              label="Delivery Location"
              value={poForm.deliveryLocation}
              onChange={(e) => setPoForm({ ...poForm, deliveryLocation: e.currentTarget.value })}
            />
          </SimpleGrid>

          <SimpleGrid cols={2}>
            <TextInput
              label="Payment Terms"
              value={poForm.paymentTerms}
              onChange={(e) => setPoForm({ ...poForm, paymentTerms: e.currentTarget.value })}
            />
            <TextInput
              label="Reference / Quotation #"
              value={poForm.reference}
              onChange={(e) => setPoForm({ ...poForm, reference: e.currentTarget.value })}
            />
          </SimpleGrid>

          <Divider label="Order Lines" labelPosition="center" my="xs" />

          {poForm.lines.map((line, idx) => (
            <SimpleGrid key={idx} cols={4} spacing="xs">
              <Select
                placeholder="Material"
                data={materialOptions}
                value={line.material}
                onChange={(v) => {
                  const m = materialById.get(v);
                  const next = [...poForm.lines];
                  next[idx] = { ...next[idx], material: v, rate: m?.standardRate || 0 };
                  setPoForm({ ...poForm, lines: next });
                }}
              />
              <NumberInput
                placeholder="Qty"
                value={line.qty}
                onChange={(v) => {
                  const next = [...poForm.lines];
                  next[idx].qty = v;
                  setPoForm({ ...poForm, lines: next });
                }}
                min={1}
              />
              <NumberInput
                placeholder="Rate"
                value={line.rate}
                onChange={(v) => {
                  const next = [...poForm.lines];
                  next[idx].rate = v;
                  setPoForm({ ...poForm, lines: next });
                }}
                prefix="Rs. "
              />
              <Button
                color="red"
                variant="subtle"
                onClick={() => setPoForm({ ...poForm, lines: poForm.lines.filter((_, i) => i !== idx) })}
                disabled={poForm.lines.length <= 1}
              >
                Remove
              </Button>
            </SimpleGrid>
          ))}

          <Button
            variant="light"
            size="xs"
            leftSection={<IconPlus size={14} />}
            onClick={() => setPoForm({ ...poForm, lines: [...poForm.lines, { material: '', qty: 100, rate: 0 }] })}
          >
            Add Line Item
          </Button>

          <Textarea
            label="Remarks"
            value={poForm.remarks}
            onChange={(e) => setPoForm({ ...poForm, remarks: e.currentTarget.value })}
          />

          <Group justify="flex-end" mt="md">
            <Button variant="default" onClick={poModalHandlers.close}>
              Cancel
            </Button>
            <Button onClick={() => createPoMutation.mutate(poForm)} loading={createPoMutation.isPending}>
              Create PO
            </Button>
          </Group>
        </Stack>
      </Modal>

      {/* CREATE GRN / RECEIVE GOODS MODAL */}
      <Modal opened={grnModalOpen} onClose={grnModalHandlers.close} title={`Goods Receipt against ${selectedPo?.code}`} size="lg">
        <Stack gap="sm">
          <SimpleGrid cols={2}>
            <TextInput
              label="Delivery Note / Supplier Invoice #"
              placeholder="e.g. DN-9011"
              value={grnForm.deliveryNote}
              onChange={(e) => setGrnForm({ ...grnForm, deliveryNote: e.currentTarget.value })}
              required
            />
            <TextInput
              label="Vehicle #"
              placeholder="e.g. LES-1234"
              value={grnForm.vehicleNo}
              onChange={(e) => setGrnForm({ ...grnForm, vehicleNo: e.currentTarget.value })}
            />
          </SimpleGrid>

          <Divider label="QC Gate Check & Received Quantities" labelPosition="center" my="xs" />

          {grnForm.lines.map((l, idx) => (
            <Card key={idx} p="xs" withBorder mb="xs">
              <Group justify="space-between" mb="xs">
                <Text fw={700} size="sm">
                  {l.materialCode} — {l.materialName}
                </Text>
                <Badge color="blue">
                  Ordered: {num(l.orderedQty, 2)} {l.uom}
                </Badge>
              </Group>
              <SimpleGrid cols={3} spacing="xs">
                <NumberInput
                  label="Accepted Qty"
                  value={l.acceptedQty}
                  onChange={(v) => {
                    const next = [...grnForm.lines];
                    next[idx].acceptedQty = v;
                    next[idx].receivedQty = (v || 0) + (next[idx].rejectedQty || 0);
                    setGrnForm({ ...grnForm, lines: next });
                  }}
                />
                <NumberInput
                  label="Rejected Qty"
                  value={l.rejectedQty}
                  onChange={(v) => {
                    const next = [...grnForm.lines];
                    next[idx].rejectedQty = v;
                    next[idx].receivedQty = (next[idx].acceptedQty || 0) + (v || 0);
                    setGrnForm({ ...grnForm, lines: next });
                  }}
                />
                <Select
                  label="QC Status"
                  data={['PASSED', 'FAILED', 'PARTIAL']}
                  value={l.qcStatus}
                  onChange={(v) => {
                    const next = [...grnForm.lines];
                    next[idx].qcStatus = v;
                    setGrnForm({ ...grnForm, lines: next });
                  }}
                />
              </SimpleGrid>
            </Card>
          ))}

          <Group justify="flex-end" mt="md">
            <Button variant="default" onClick={grnModalHandlers.close}>
              Cancel
            </Button>
            <Button color="teal" onClick={() => createGrnMutation.mutate(grnForm)} loading={createGrnMutation.isPending}>
              Post Goods Receipt
            </Button>
          </Group>
        </Stack>
      </Modal>

      {/* 3-WAY MATCH MODAL */}
      <Modal opened={matchModalOpen} onClose={matchModalHandlers.close} title="3-Way Match Verification Matrix" size="lg">
        {matchData && (
          <Stack gap="md">
            <Alert color={matchData.passed ? 'teal' : 'orange'} icon={<IconReceipt2 size={20} />}>
              <Text fw={700}>{matchData.passed ? '3-Way Match Verified' : 'Discrepancy / Exception Detected'}</Text>
              <Text size="xs">
                Comparison between Purchase Order expectations, Warehouse GRN physical receipts, and Supplier Invoices.
              </Text>
            </Alert>

            <Table fz="xs" highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Material</Table.Th>
                  <Table.Th ta="right">PO Ordered</Table.Th>
                  <Table.Th ta="right">GRN Received</Table.Th>
                  <Table.Th ta="right">Invoiced</Table.Th>
                  <Table.Th ta="center">Match Status</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {matchData.lines.map((l, i) => (
                  <Table.Tr key={i}>
                    <Table.Td fw={600}>{l.materialName}</Table.Td>
                    <Table.Td ta="right">{num(l.orderedQty, 2)}</Table.Td>
                    <Table.Td ta="right">{num(l.receivedQty, 2)}</Table.Td>
                    <Table.Td ta="right">{num(l.invoicedQty, 2)}</Table.Td>
                    <Table.Td ta="center">
                      <Badge color={l.receivedQty >= l.orderedQty ? 'teal' : 'orange'}>
                        {l.receivedQty >= l.orderedQty ? 'Matched' : 'Pending'}
                      </Badge>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Stack>
        )}
      </Modal>

      {/* NEW RFQ MODAL */}
      <Modal opened={rfqModalOpen} onClose={rfqModalHandlers.close} title="Create Request for Quotation (RFQ)" size="md">
        <Stack gap="sm">
          <TextInput
            label="RFQ Title"
            placeholder="e.g. Raw Flour & Sugar Q4 Bulk Supply"
            value={rfqForm.title}
            onChange={(e) => setRfqForm({ ...rfqForm, title: e.currentTarget.value })}
            required
          />
          <Select
            label="Target Material"
            data={materialOptions}
            value={rfqForm.lines[0]?.material}
            onChange={(v) => {
              setRfqForm({ ...rfqForm, lines: [{ material: v, qty: 1000, targetRate: 0 }] });
            }}
            required
          />
          <NumberInput
            label="Required Quantity"
            value={rfqForm.lines[0]?.qty}
            onChange={(v) => {
              const next = [...rfqForm.lines];
              next[0].qty = v;
              setRfqForm({ ...rfqForm, lines: next });
            }}
          />
          <Group justify="flex-end" mt="md">
            <Button variant="default" onClick={rfqModalHandlers.close}>
              Cancel
            </Button>
            <Button onClick={() => createRfqMutation.mutate(rfqForm)} loading={createRfqMutation.isPending}>
              Create RFQ
            </Button>
          </Group>
        </Stack>
      </Modal>

      {/* RECORD QUOTE MODAL */}
      <Modal opened={quoteModalOpen} onClose={quoteModalHandlers.close} title={`Record Quotation for ${selectedRfq?.code}`} size="md">
        <Stack gap="sm">
          <Select
            label="Bidding Supplier"
            data={suppliers}
            value={quoteForm.supplier}
            onChange={(v) => setQuoteForm({ ...quoteForm, supplier: v })}
            required
          />
          <NumberInput
            label="Quoted Rate / Unit"
            value={quoteForm.lines[0]?.rate}
            onChange={(v) => {
              const next = [...quoteForm.lines];
              next[0].rate = v;
              setQuoteForm({ ...quoteForm, lines: next });
            }}
            prefix="Rs. "
            required
          />
          <Group justify="flex-end" mt="md">
            <Button variant="default" onClick={quoteModalHandlers.close}>
              Cancel
            </Button>
            <Button
              onClick={() => recordQuoteMutation.mutate({ id: selectedRfq._id, payload: quoteForm })}
              loading={recordQuoteMutation.isPending}
            >
              Submit Quotation
            </Button>
          </Group>
        </Stack>
      </Modal>
    </PageTransition>
  );
}
