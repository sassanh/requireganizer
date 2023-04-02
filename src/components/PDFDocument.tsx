import React from "react";
import { UserStory, Requirement, AcceptanceCriteria } from "../types";
import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import { observer } from "mobx-react-lite";

interface PDFDocumentProps {
  userStories: UserStory[];
  requirements: Requirement[];
  acceptanceCriteria: AcceptanceCriteria[];
}

const styles = StyleSheet.create({
  page: {
    padding: 30,
  },
  section: {
    marginBottom: 15,
  },
  title: {
    fontSize: 18,
    marginBottom: 5,
  },
  item: {
    fontSize: 14,
    marginBottom: 3,
  },
});

const PDFDocument: React.FunctionComponent<PDFDocumentProps> = ({
  userStories,
  requirements,
  acceptanceCriteria,
}) => {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.section}>
          <Text style={styles.title}>User Stories</Text>
          {userStories.map((story) => (
            <Text key={story.id} style={styles.item}>
              {story.content}
            </Text>
          ))}
        </View>
        <View style={styles.section}>
          <Text style={styles.title}>Requirements</Text>
          {requirements.map((req) => (
            <Text key={req.id} style={styles.item}>
              {req.content}
            </Text>
          ))}
        </View>
        <View style={styles.section}>
          <Text style={styles.title}>Acceptance Criteria</Text>
          {acceptanceCriteria.map((criteria) => (
            <Text key={criteria.id} style={styles.item}>
              {criteria.content}
            </Text>
          ))}
        </View>
      </Page>
    </Document>
  );
};

export default observer(PDFDocument);
