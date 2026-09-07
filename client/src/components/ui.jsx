import { motion } from 'framer-motion';
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Card,
  Center,
  Group,
  Loader,
  Menu,
  Paper,
  Stack,
  Text,
  ThemeIcon,
  Title,
  Tooltip,
} from '@mantine/core';
import { IconDownload, IconFileTypeCsv, IconFileTypePdf, IconMoodEmpty } from '@tabler/icons-react';
import { STATUS_COLORS } from '../theme';
import { humanise, money, moneyShort, signed } from '../utils/format';
import { downloadReport, showError, showSuccess } from '../api/client';
import { useState } from 'react';

/* ----------------------------- page transition ---------------------------- */

export function PageTransition({ children }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}

/** Staggers children in as they mount. */
export function Stagger({ children, delay = 0 }) {
  return (
    <motion.div
      initial="hidden"
      animate="show"
      variants={{
        hidden: {},
        show: { transition: { staggerChildren: 0.06, delayChildren: delay } },
      }}
    >
      {children}
    </motion.div>
  );
}

export function StaggerItem({ children, ...rest }) {
  return (
    <motion.div
      variants={{
        hidden: { opacity: 0, y: 18 },
        show: { opacity: 1, y: 0, transition: { duration: 0.45, ease: [0.22, 1, 0.36, 1] } },
      }}
      {...rest}
    >
      {children}
    </motion.div>
  );
}

/* -------------------------------- page header ----------------------------- */

export function PageHeader({ title, subtitle, icon: Icon, actions, badge }) {
  return (
    <Box mb="lg">
      <Group justify="space-between" align="flex-start" wrap="wrap" gap="md">
        <Group gap="md" wrap="nowrap" align="flex-start">
          {Icon && (
            <motion.div
              initial={{ scale: 0.6, opacity: 0, rotate: -12 }}
              animate={{ scale: 1, opacity: 1, rotate: 0 }}
              transition={{ type: 'spring', stiffness: 220, damping: 18 }}
            >
              <ThemeIcon size={44} radius="md" variant="light" color="biscuit">
                <Icon size={24} />
              </ThemeIcon>
            </motion.div>
          )}
          <div>
            <Group gap="xs" align="center">
              <Title order={1}>{title}</Title>
              {badge}
            </Group>
            {subtitle && (
              <Text c="dimmed" size="sm" mt={4} maw={720}>
                {subtitle}
              </Text>
            )}
          </div>
        </Group>
        {actions && <Group gap="xs">{actions}</Group>}
      </Group>
    </Box>
  );
}

/* --------------------------------- stat tile ------------------------------ */

export function StatCard({ label, value, sub, icon: Icon, color = 'biscuit', trend, compact = false }) {
  return (
    <Card className="erp-lift" p={compact ? 'sm' : 'md'} h="100%">
      <Group justify="space-between" wrap="nowrap" align="flex-start" gap="xs">
        <div style={{ minWidth: 0 }}>
          <Text size="xs" c="dimmed" fw={600} tt="uppercase" style={{ letterSpacing: '0.04em' }}>
            {label}
          </Text>
          <Text fw={800} size={compact ? 'lg' : 'xl'} mt={6} style={{ lineHeight: 1.15 }}>
            {value}
          </Text>
          {sub && (
            <Text size="xs" c="dimmed" mt={4}>
              {sub}
            </Text>
          )}
          {trend != null && (
            <Badge mt={8} size="sm" variant="light" color={trend > 0 ? 'red' : trend < 0 ? 'teal' : 'gray'}>
              {signed(trend, 4)} vs standard
            </Badge>
          )}
        </div>
        {Icon && (
          <ThemeIcon size={38} radius="md" variant="light" color={color}>
            <Icon size={20} />
          </ThemeIcon>
        )}
      </Group>
    </Card>
  );
}

/* --------------------------------- badges --------------------------------- */

export function StatusBadge({ status, size = 'sm' }) {
  if (!status) return null;
  return (
    <Badge size={size} variant="light" color={STATUS_COLORS[status] || 'gray'}>
      {humanise(status)}
    </Badge>
  );
}

export function VarianceText({ value, dp = 2, asMoney = true }) {
  const n = Number(value) || 0;
  const color = Math.abs(n) < 0.005 ? 'dimmed' : n > 0 ? 'red.6' : 'teal.7';
  const text = asMoney ? (n > 0 ? '+' : '') + money(n, dp).replace('Rs. ', '') : signed(n, dp);
  return (
    <Text component="span" c={color} fw={600} ff="monospace" size="sm">
      {text}
    </Text>
  );
}

export function Money({ value, short = false, dp = 2, ...rest }) {
  return (
    <Text component="span" ff="monospace" {...rest}>
      {short ? moneyShort(value) : money(value, dp)}
    </Text>
  );
}

/* ------------------------------ empty / loading --------------------------- */

export function EmptyState({ title = 'Nothing here yet', description, action, icon: Icon = IconMoodEmpty }) {
  return (
    <Paper withBorder p="xl" radius="lg">
      <Center>
        <Stack align="center" gap="xs" maw={420}>
          <ThemeIcon size={54} radius="xl" variant="light" color="gray">
            <Icon size={26} />
          </ThemeIcon>
          <Text fw={700} size="lg" mt="xs">
            {title}
          </Text>
          {description && (
            <Text c="dimmed" size="sm" ta="center">
              {description}
            </Text>
          )}
          {action && <Box mt="sm">{action}</Box>}
        </Stack>
      </Center>
    </Paper>
  );
}

export function Loading({ label = 'Loading' }) {
  return (
    <Center py={60}>
      <Stack align="center" gap="sm">
        <Loader color="biscuit" type="bars" />
        <Text size="sm" c="dimmed">
          {label}
        </Text>
      </Stack>
    </Center>
  );
}

/* ------------------------------ export buttons ---------------------------- */

export function ExportMenu({ reportKey, params = {}, label = 'Export', disabled = false }) {
  const [busy, setBusy] = useState(false);

  const run = async (format) => {
    setBusy(true);
    try {
      const name = await downloadReport(reportKey, { format, params });
      showSuccess(name + ' downloaded', 'Export ready');
    } catch (e) {
      showError(e, 'Export failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Menu shadow="md" position="bottom-end" withinPortal>
      <Menu.Target>
        <Button
          variant="default"
          leftSection={<IconDownload size={16} />}
          loading={busy}
          disabled={disabled}
        >
          {label}
        </Button>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Label>Download this view</Menu.Label>
        <Menu.Item leftSection={<IconFileTypeCsv size={16} />} onClick={() => run('csv')}>
          CSV (opens in Excel)
        </Menu.Item>
        <Menu.Item leftSection={<IconFileTypePdf size={16} />} onClick={() => run('pdf')}>
          PDF (print ready)
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}

export function IconButton({ label, icon: Icon, ...rest }) {
  return (
    <Tooltip label={label}>
      <ActionIcon variant="subtle" {...rest}>
        <Icon size={17} />
      </ActionIcon>
    </Tooltip>
  );
}

/* --------------------------------- section -------------------------------- */

export function Section({ title, description, actions, children, ...rest }) {
  return (
    <Card mb="md" {...rest}>
      {(title || actions) && (
        <Group justify="space-between" mb="md" align="flex-start" wrap="wrap" gap="xs">
          <div>
            {title && <Title order={3}>{title}</Title>}
            {description && (
              <Text size="xs" c="dimmed" mt={2}>
                {description}
              </Text>
            )}
          </div>
          {actions && <Group gap="xs">{actions}</Group>}
        </Group>
      )}
      {children}
    </Card>
  );
}
