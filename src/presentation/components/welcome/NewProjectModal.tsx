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

interface NewProjectModalProps {
  opened: boolean;
  onClose: () => void;
  onCreate: (name: string, width: number, height: number, roomName?: string) => void;
}

export const NewProjectModal: React.FC<NewProjectModalProps> = ({ opened, onClose, onCreate }) => {
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
          <Text fw={700} size="sm">
            Создание нового проекта
          </Text>
        </Group>
      }
      size="md"
      centered
      overlayProps={{ backgroundOpacity: 0.65, blur: 3 }}
      styles={{
        header: { backgroundColor: '#1E1F22', borderBottom: '1px solid #2B2D30' },
        content: { backgroundColor: '#1E1F22', border: '1px solid #383A42', borderRadius: 8 },
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
            input: { backgroundColor: '#2B2D30', borderColor: '#3E4249', color: '#FFF' },
            label: { color: '#C0C4CC', fontSize: 13, marginBottom: 4 },
          }}
        />

        <Divider label="Размеры стены" labelPosition="left" color="#2B2D30" />

        <Group grow>
          <NumberInput
            label="Ширина (мм)"
            value={width}
            onChange={(val) => setWidth(Number(val) || 3600)}
            min={500}
            max={12000}
            step={100}
            styles={{
              input: { backgroundColor: '#2B2D30', borderColor: '#3E4249', color: '#FFF' },
              label: { color: '#C0C4CC', fontSize: 12 },
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
              input: { backgroundColor: '#2B2D30', borderColor: '#3E4249', color: '#FFF' },
              label: { color: '#C0C4CC', fontSize: 12 },
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
