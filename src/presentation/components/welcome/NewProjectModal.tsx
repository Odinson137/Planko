import React, { useState } from 'react';
import {
  Modal,
  TextInput,
  NumberInput,
  Button,
  Group,
  Stack,
  Text,
  ThemeIcon,
  Divider,
} from '@mantine/core';
import { Plus } from 'lucide-react';
import { useAppTheme } from '../../theme/useAppTheme';

interface NewProjectModalProps {
  opened: boolean;
  onClose: () => void;
  onCreate: (name: string, width: number, height: number, roomName?: string) => void;
}

export const NewProjectModal: React.FC<NewProjectModalProps> = ({ opened, onClose, onCreate }) => {
  const t = useAppTheme();
  const [name, setName] = useState('');
  const [width, setWidth] = useState<number>(3600);
  const [height, setHeight] = useState<number>(2750);

  const handleCreate = () => {
    const finalName = name.trim() || 'Новый проект';
    onCreate(finalName, width, height);
    setName('');
    setWidth(3600);
    setHeight(2750);
  };

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={
        <Group gap="xs">
          <ThemeIcon size="sm" variant="light" color="blue">
            <Plus size={14} />
          </ThemeIcon>
          <Text fw={700} size="sm" c={t.textPrimary}>
            Создание нового проекта
          </Text>
        </Group>
      }
      size="md"
      centered
      overlayProps={{ backgroundOpacity: 0.65, blur: 3 }}
      styles={{
        header: { backgroundColor: t.bgHeader, borderBottom: `1px solid ${t.border}` },
        content: { backgroundColor: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 8 },
        body: { padding: 20 },
      }}
    >
      <Stack gap="md">
        <TextInput
          label="Название проекта"
          placeholder="Например: Стена в гостиной"
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
          data-autofocus
          styles={{
            input: { backgroundColor: t.bgInput, borderColor: t.borderInput, color: t.textPrimary },
            label: { color: t.textDimmed, fontSize: 13, marginBottom: 4 },
          }}
        />

        <Divider label="Размеры стены" labelPosition="left" color={t.border} />

        <Group grow>
          <NumberInput
            label="Ширина (мм)"
            value={width}
            onChange={(val) => setWidth(Number(val) || 3600)}
            min={500}
            max={12000}
            step={100}
            styles={{
              input: { backgroundColor: t.bgInput, borderColor: t.borderInput, color: t.textPrimary },
              label: { color: t.textDimmed, fontSize: 12 },
            }}
          />
          <NumberInput
            label="Высота (мм)"
            value={height}
            onChange={(val) => setHeight(Number(val) || 2750)}
            min={500}
            max={6000}
            step={50}
            styles={{
              input: { backgroundColor: t.bgInput, borderColor: t.borderInput, color: t.textPrimary },
              label: { color: t.textDimmed, fontSize: 12 },
            }}
          />
        </Group>

        <Group justify="flex-end" mt="md" gap="xs">
          <Button variant="subtle" color="gray" onClick={onClose} size="sm">
            Отмена
          </Button>
          <Button variant="filled" color="blue" onClick={handleCreate} size="sm">
            Создать проект
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
};
