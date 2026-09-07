import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Card,
  Grid,
  Group,
  NumberInput,
  PasswordInput,
  SimpleGrid,
  Stack,
  Text,
  Textarea,
  TextInput,
  Title,
} from '@mantine/core';
import { IconAlertTriangle, IconBuildingBank, IconLock, IconSettings } from '@tabler/icons-react';
import { api, showError, showSuccess } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { Loading, PageHeader, PageTransition, Section } from '../components/ui';
import { money } from '../utils/format';

export default function SettingsPage() {
  const qc = useQueryClient();
  const { can, user } = useAuth();
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [pwBusy, setPwBusy] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['settings'],
    queryFn: async () => (await api.get('/settings')).data.data,
  });

  useEffect(() => {
    if (data) setForm(data);
  }, [data]);

  const save = async () => {
    setSaving(true);
    try {
      const payload = {
        companyName: form.companyName,
        address: form.address,
        ntn: form.ntn,
        strn: form.strn,
        currencySymbol: form.currencySymbol,
        defaultSalesTaxRate: form.defaultSalesTaxRate,
        furtherTaxRate: form.furtherTaxRate,
        withholdingTaxRate: form.withholdingTaxRate,
        labourRatePerUnit: form.labourRatePerUnit,
        overheadRatePerUnit: form.overheadRatePerUnit,
        adminRatePerUnit: form.adminRatePerUnit,
        marketingRatePerUnit: form.marketingRatePerUnit,
        lowStockThresholdPercent: form.lowStockThresholdPercent,
      };
      await api.put('/settings', payload);
      showSuccess('Settings saved');
      qc.invalidateQueries({ queryKey: ['settings'] });
    } catch (e) {
      showError(e, 'Could not save settings');
    } finally {
      setSaving(false);
    }
  };

  const changePassword = async () => {
    if (pw.newPassword !== pw.confirm) return showError({ friendly: 'The two new passwords do not match' });
    setPwBusy(true);
    try {
      await api.post('/auth/change-password', {
        currentPassword: pw.currentPassword,
        newPassword: pw.newPassword,
      });
      showSuccess('Password updated');
      setPw({ currentPassword: '', newPassword: '', confirm: '' });
    } catch (e) {
      showError(e, 'Could not change the password');
    } finally {
      setPwBusy(false);
    }
    return undefined;
  };

  if (isLoading || !form) return <Loading label="Loading settings" />;

  const editable = can('settings.manage');
  const standardUnitCost =
    (form.labourRatePerUnit || 0) + (form.overheadRatePerUnit || 0);
  const periodCost = (form.adminRatePerUnit || 0) + (form.marketingRatePerUnit || 0);

  return (
    <PageTransition>
      <PageHeader
        icon={IconSettings}
        title="Settings"
        subtitle="Company identity, default absorption rates for new recipes, and tax configuration."
        actions={
          editable && (
            <Button loading={saving} onClick={save}>
              Save settings
            </Button>
          )
        }
      />

      <Grid gutter="md">
        <Grid.Col span={{ base: 12, lg: 7 }}>
          <Section title="Company" description="Printed on every PDF report">
            <SimpleGrid cols={{ base: 1, xs: 2 }} spacing="sm">
              <TextInput
                label="Company name"
                value={form.companyName}
                onChange={(e) => setForm({ ...form, companyName: e.currentTarget.value })}
                disabled={!editable}
              />
              <TextInput
                label="Currency symbol"
                value={form.currencySymbol}
                onChange={(e) => setForm({ ...form, currencySymbol: e.currentTarget.value })}
                disabled={!editable}
              />
              <TextInput
                label="NTN"
                value={form.ntn}
                onChange={(e) => setForm({ ...form, ntn: e.currentTarget.value })}
                disabled={!editable}
              />
              <TextInput
                label="STRN"
                value={form.strn}
                onChange={(e) => setForm({ ...form, strn: e.currentTarget.value })}
                disabled={!editable}
              />
            </SimpleGrid>
            <Textarea
              mt="sm"
              label="Address"
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.currentTarget.value })}
              minRows={2}
              disabled={!editable}
            />
          </Section>

          <Section
            title="Default costing rates"
            description="Applied to new recipes. Existing recipes keep the rates they were approved with."
          >
            <SimpleGrid cols={{ base: 2, md: 4 }} spacing="sm">
              <NumberInput
                label="Direct labour / unit"
                value={form.labourRatePerUnit}
                onChange={(v) => setForm({ ...form, labourRatePerUnit: v })}
                decimalScale={4}
                step={0.01}
                min={0}
                prefix="Rs. "
                disabled={!editable}
              />
              <NumberInput
                label="Factory overhead / unit"
                value={form.overheadRatePerUnit}
                onChange={(v) => setForm({ ...form, overheadRatePerUnit: v })}
                decimalScale={4}
                step={0.01}
                min={0}
                prefix="Rs. "
                disabled={!editable}
              />
              <NumberInput
                label="Admin / unit"
                value={form.adminRatePerUnit}
                onChange={(v) => setForm({ ...form, adminRatePerUnit: v })}
                decimalScale={4}
                step={0.01}
                min={0}
                prefix="Rs. "
                disabled={!editable}
              />
              <NumberInput
                label="Marketing / unit"
                value={form.marketingRatePerUnit}
                onChange={(v) => setForm({ ...form, marketingRatePerUnit: v })}
                decimalScale={4}
                step={0.01}
                min={0}
                prefix="Rs. "
                disabled={!editable}
              />
            </SimpleGrid>

            <Card withBorder mt="sm" p="sm" bg="var(--mantine-color-default-hover)">
              <Group justify="space-between">
                <Text size="xs" c="dimmed">
                  Conversion cost added to material cost (inventoriable)
                </Text>
                <Text size="sm" fw={700} ff="monospace">
                  {money(standardUnitCost, 4)}
                </Text>
              </Group>
              <Group justify="space-between" mt={4}>
                <Text size="xs" c="dimmed">
                  Period cost added for management full cost only
                </Text>
                <Text size="sm" fw={700} ff="monospace">
                  {money(periodCost, 4)}
                </Text>
              </Group>
            </Card>
          </Section>

          <Section title="Tax configuration">
            <Alert color="orange" variant="light" icon={<IconAlertTriangle size={18} />} mb="sm">
              These rates are illustrative defaults. Confirm the rate, exemptions and any further tax that actually
              apply to your product under current law before filing.
            </Alert>
            <SimpleGrid cols={{ base: 1, xs: 3 }} spacing="sm">
              <NumberInput
                label="Standard sales tax %"
                value={form.defaultSalesTaxRate}
                onChange={(v) => setForm({ ...form, defaultSalesTaxRate: v })}
                min={0}
                max={100}
                suffix="%"
                disabled={!editable}
              />
              <NumberInput
                label="Further tax %"
                description="Sales to unregistered buyers"
                value={form.furtherTaxRate}
                onChange={(v) => setForm({ ...form, furtherTaxRate: v })}
                min={0}
                max={100}
                suffix="%"
                disabled={!editable}
              />
              <NumberInput
                label="Withholding tax %"
                value={form.withholdingTaxRate}
                onChange={(v) => setForm({ ...form, withholdingTaxRate: v })}
                min={0}
                max={100}
                suffix="%"
                disabled={!editable}
              />
            </SimpleGrid>
          </Section>
        </Grid.Col>

        <Grid.Col span={{ base: 12, lg: 5 }}>
          <Section title="Your account">
            <Stack gap={6} mb="md">
              <Group justify="space-between">
                <Text size="sm" c="dimmed">
                  Name
                </Text>
                <Text size="sm" fw={600}>
                  {user.name}
                </Text>
              </Group>
              <Group justify="space-between">
                <Text size="sm" c="dimmed">
                  Email
                </Text>
                <Text size="sm">{user.email}</Text>
              </Group>
              <Group justify="space-between">
                <Text size="sm" c="dimmed">
                  Role
                </Text>
                <Text size="sm" fw={600}>
                  {user.roleLabel}
                </Text>
              </Group>
              <Group justify="space-between">
                <Text size="sm" c="dimmed">
                  Permissions
                </Text>
                <Text size="sm">{user.permissions.length}</Text>
              </Group>
            </Stack>

            <Title order={4} mb="xs">
              Change password
            </Title>
            <Stack gap="sm">
              <PasswordInput
                label="Current password"
                leftSection={<IconLock size={15} />}
                value={pw.currentPassword}
                onChange={(e) => setPw({ ...pw, currentPassword: e.currentTarget.value })}
              />
              <PasswordInput
                label="New password"
                description="At least 6 characters"
                value={pw.newPassword}
                onChange={(e) => setPw({ ...pw, newPassword: e.currentTarget.value })}
              />
              <PasswordInput
                label="Confirm new password"
                value={pw.confirm}
                onChange={(e) => setPw({ ...pw, confirm: e.currentTarget.value })}
              />
              <Button
                variant="light"
                loading={pwBusy}
                onClick={changePassword}
                disabled={!pw.currentPassword || pw.newPassword.length < 6}
              >
                Update password
              </Button>
            </Stack>
          </Section>

          <Section title="About this system">
            <Stack gap={6}>
              <Group justify="space-between">
                <Text size="xs" c="dimmed">
                  Stack
                </Text>
                <Text size="xs">React + Node/Express + MongoDB</Text>
              </Group>
              <Group justify="space-between">
                <Text size="xs" c="dimmed">
                  Inventory valuation
                </Text>
                <Text size="xs">Moving average</Text>
              </Group>
              <Group justify="space-between">
                <Text size="xs" c="dimmed">
                  Costing method
                </Text>
                <Text size="xs">Standard costing with variance accounts</Text>
              </Group>
              <Group justify="space-between">
                <Text size="xs" c="dimmed">
                  Version
                </Text>
                <Text size="xs">1.0.0</Text>
              </Group>
            </Stack>

            <Alert mt="md" color="blue" variant="light" icon={<IconBuildingBank size={16} />} p="xs">
              <Text size="xs">
                This system is not connected to FBR, a bank, or a payroll provider. Integrations would be added as
                separate services against this API.
              </Text>
            </Alert>
          </Section>
        </Grid.Col>
      </Grid>
    </PageTransition>
  );
}
