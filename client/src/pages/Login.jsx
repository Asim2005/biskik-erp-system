import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Alert,
  Anchor,
  Badge,
  Box,
  Button,
  Card,
  Center,
  Divider,
  Group,
  PasswordInput,
  ScrollArea,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { IconAlertCircle, IconLock, IconMail } from '@tabler/icons-react';
import { useAuth } from '../context/AuthContext';

const DEMO_ACCOUNTS = [
  ['admin@biscuiterp.pk', 'Admin@123', 'Administrator', 'Full access'],
  ['procurement@biscuiterp.pk', 'Procure@123', 'Procurement Officer', 'RFQs, POs, and Supplier Bids'],
  ['procurement.manager@biscuiterp.pk', 'Procure@456', 'Procurement Manager', 'Approves POs & Awards RFQs'],
  ['finance@biscuiterp.pk', 'Finance@123', 'Finance Manager', 'Approves recipes, posts the GL'],
  ['production@biscuiterp.pk', 'Production@123', 'Production Manager', 'Runs production orders'],
  ['store@biscuiterp.pk', 'Store@123', 'Store Keeper', 'Issues and receives stock'],
  ['qa@biscuiterp.pk', 'Qa@123456', 'QA / R&D', 'Writes and submits formulas'],
  ['sales@biscuiterp.pk', 'Sales@123', 'Sales Officer', 'Customers and invoices'],
  ['viewer@biscuiterp.pk', 'Viewer@123', 'Viewer', 'Read only'],
];

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('admin@biscuiterp.pk');
  const [password, setPassword] = useState('Admin@123');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e?.preventDefault();
    setLoading(true);
    setError('');
    try {
      await login(email.trim(), password);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err?.friendly || 'Sign in failed');
    } finally {
      setLoading(false);
    }
  };

  const useAccount = (mail, pass) => {
    setEmail(mail);
    setPassword(pass);
  };

  return (
    <Box className="erp-hero" mih="100vh">
      <Center mih="100vh" p="md">
        <SimpleGrid cols={{ base: 1, md: 2 }} spacing={40} maw={1020} w="100%">
          {/* ------------------------------ brand ------------------------------ */}
          <motion.div
            initial={{ opacity: 0, x: -24 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          >
            <Stack justify="center" h="100%" gap="lg">
              <Group gap="sm">
                <motion.div
                  animate={{ rotate: [0, -10, 10, 0], scale: [1, 1.08, 1] }}
                  transition={{ duration: 3, repeat: Infinity, repeatDelay: 3 }}
                  style={{ fontSize: 46, lineHeight: 1 }}
                >
                  🍪
                </motion.div>
                <div>
                  <Title order={1} style={{ letterSpacing: '-0.02em' }}>
                    Biscuit Manufacturing ERP
                  </Title>
                  <Text c="dimmed" size="sm">
                    Recipe control, production costing, inventory, accounts and sales tax
                  </Text>
                </div>
              </Group>

              <Stack gap="sm">
                {[
                  ['Version-controlled recipes', 'Formulas are approved before they can ever reach the shop floor.'],
                  ['Estimated vs actual costing', 'Usage, price, labour, overhead and yield variances, line by line.'],
                  ['Books that tie out', 'Every issue and receipt posts to the ledger, so stock and the GL always agree.'],
                  ['Excel-style data entry', 'Paste a formula straight from a spreadsheet; export any report to CSV or PDF.'],
                ].map(([title, body], i) => (
                  <motion.div
                    key={title}
                    initial={{ opacity: 0, y: 14 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.25 + i * 0.1, duration: 0.5 }}
                  >
                    <Group align="flex-start" gap="sm" wrap="nowrap">
                      <Badge size="sm" variant="light" color="biscuit" mt={2}>
                        {String(i + 1).padStart(2, '0')}
                      </Badge>
                      <div>
                        <Text fw={700} size="sm">
                          {title}
                        </Text>
                        <Text size="xs" c="dimmed">
                          {body}
                        </Text>
                      </div>
                    </Group>
                  </motion.div>
                ))}
              </Stack>
            </Stack>
          </motion.div>

          {/* ------------------------------ form ------------------------------- */}
          <motion.div
            initial={{ opacity: 0, y: 26 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
          >
            <Card shadow="lg" p="xl" radius="lg">
              <Title order={2} mb={4}>
                Sign in
              </Title>
              <Text size="sm" c="dimmed" mb="lg">
                Use one of the demo accounts below, or your own credentials.
              </Text>

              <form onSubmit={submit}>
                <Stack gap="sm">
                  <TextInput
                    label="Email"
                    placeholder="you@company.pk"
                    leftSection={<IconMail size={16} />}
                    value={email}
                    onChange={(e) => setEmail(e.currentTarget.value)}
                    required
                    autoComplete="username"
                  />
                  <PasswordInput
                    label="Password"
                    placeholder="Your password"
                    leftSection={<IconLock size={16} />}
                    value={password}
                    onChange={(e) => setPassword(e.currentTarget.value)}
                    required
                    autoComplete="current-password"
                  />

                  {error && (
                    <Alert color="red" icon={<IconAlertCircle size={16} />} radius="md" py="xs">
                      {error}
                    </Alert>
                  )}

                  <Button type="submit" fullWidth loading={loading} size="md" mt={4}>
                    Sign in
                  </Button>
                </Stack>
              </form>

              <Divider my="lg" label="Demo accounts" labelPosition="center" />

              <ScrollArea h={230} type="auto" offsetScrollbars>
                <Stack gap={8} pr="xs">
                  {DEMO_ACCOUNTS.map(([mail, pass, role, note]) => (
                    <Card
                      key={mail}
                      p="xs"
                      withBorder
                      radius="md"
                      className="erp-lift"
                      style={{ cursor: 'pointer', flexShrink: 0 }}
                      onClick={() => useAccount(mail, pass)}
                    >
                      <Group justify="space-between" wrap="nowrap" gap="xs">
                        <div style={{ minWidth: 0 }}>
                          <Text size="xs" fw={700}>
                            {role}
                          </Text>
                          <Text size="10px" c="dimmed" truncate>
                            {note}
                          </Text>
                        </div>
                        <Anchor component="span" size="10px" ff="monospace">
                          {pass}
                        </Anchor>
                      </Group>
                    </Card>
                  ))}
                </Stack>
              </ScrollArea>
            </Card>
          </motion.div>
        </SimpleGrid>
      </Center>
    </Box>
  );
}
